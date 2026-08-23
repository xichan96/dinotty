#![allow(clippy::unwrap_used, clippy::expect_used, clippy::too_many_lines)]
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::helpers::{plugin_err, version_gt};
use super::manager::PluginManagerState;
use super::types::{MarketPlugin, RegistryIndex};

const REGISTRY_CACHE_TTL: Duration = Duration::from_mins(5);

const DEFAULT_REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/xichan96/dinotty-plugins/main/registry.json";

struct RegistryCache {
    data: RwLock<Option<(Instant, String)>>,
}

static REGISTRY_CACHE: std::sync::LazyLock<RegistryCache> =
    std::sync::LazyLock::new(|| RegistryCache { data: RwLock::new(None) });

/// Fetch the registry JSON, using a 5-minute in-memory cache to avoid
/// repeated cold-start HTTP round-trips to GitHub on every page load.
async fn fetch_cached_registry() -> Result<String, Box<Response>> {
    {
        let guard = REGISTRY_CACHE.data.read().await;
        if let Some((fetched_at, ref body)) = *guard {
            if fetched_at.elapsed() < REGISTRY_CACHE_TTL {
                return Ok(body.clone());
            }
        }
    }

    let registry_url =
        std::env::var("DINOTTY_REGISTRY_URL").unwrap_or_else(|_| DEFAULT_REGISTRY_URL.into());

    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;
    let resp = client.get(&registry_url).send().await.map_err(|e| {
        Box::new(plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to fetch registry: {e}")))
    })?;

    let body = resp.text().await.map_err(|e| {
        Box::new(plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to read registry: {e}")))
    })?;

    let _: RegistryIndex = serde_json::from_str(&body).map_err(|e| {
        Box::new(plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}")))
    })?;

    {
        let mut guard = REGISTRY_CACHE.data.write().await;
        *guard = Some((Instant::now(), body.clone()));
    }

    Ok(body)
}

pub async fn get_market_registry(State(pm): State<PluginManagerState>) -> Response {
    let body = match fetch_cached_registry().await {
        Ok(b) => b,
        Err(resp) => return *resp,
    };

    let registry: RegistryIndex = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}"))
        }
    };

    let host_target = pm.host_target;
    let mut market: Vec<MarketPlugin> = registry
        .plugins
        .into_iter()
        .map(|entry| {
            let installed = pm.registry.get(&entry.id);
            let installed_version = installed.as_ref().map(|i| i.manifest.version.clone());
            let has_update =
                installed_version.as_ref().is_some_and(|v| version_gt(&entry.version, v));
            let compatible = super::helpers::is_compatible(entry.targets.as_deref(), host_target);

            MarketPlugin {
                id: entry.id,
                name: entry.name,
                description: entry.description,
                description_zh: entry.description_zh,
                version: entry.version,
                icon: entry.icon,
                repo: entry.repo,
                branch: entry.branch,
                subdir: entry.subdir,
                author: entry.author,
                homepage: entry.homepage,
                installed_version,
                has_update,
                category: entry.category,
                targets: entry.targets,
                show_in_toolbar: entry.show_in_toolbar,
                compatible,
            }
        })
        .collect();
    market.sort_by_key(|a| a.name.to_lowercase());

    Json(market).into_response()
}

/// # Panics
/// Panics if the response builder fails.
pub async fn get_market_readme(Path(id): Path<String>) -> Response {
    let body = match fetch_cached_registry().await {
        Ok(b) => b,
        Err(resp) => return *resp,
    };

    let registry: RegistryIndex = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("invalid registry JSON: {e}"))
        }
    };

    let client = &crate::proxy::HTTP_CLIENT_FOLLOW_REDIRECTS;

    let Some(entry) = registry.plugins.iter().find(|p| p.id == id) else {
        return plugin_err(StatusCode::NOT_FOUND, "plugin not found in registry");
    };

    let readme_url = match &entry.subdir {
        Some(sub) => format!(
            "https://raw.githubusercontent.com/{}/{}/{}/README.md",
            entry.repo, entry.branch, sub
        ),
        None => {
            format!("https://raw.githubusercontent.com/{}/{}/README.md", entry.repo, entry.branch)
        }
    };

    let readme_resp = match client.get(&readme_url).send().await {
        Ok(r) => r,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to fetch README: {e}"))
        }
    };

    if readme_resp.status().as_u16() == 404 {
        return plugin_err(StatusCode::NOT_FOUND, "README not found");
    }

    if !readme_resp.status().is_success() {
        return plugin_err(
            StatusCode::BAD_GATEWAY,
            &format!("GitHub returned {}", readme_resp.status()),
        );
    }

    let readme_text = match readme_resp.text().await {
        Ok(t) => t,
        Err(e) => {
            return plugin_err(StatusCode::BAD_GATEWAY, &format!("failed to read README: {e}"))
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Cache-Control", "public, max-age=3600")
        .body(Body::from(readme_text))
        .unwrap()
}
