use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandBookmark {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceBookmark {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebBookmark {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecentEntry {
    pub path_or_url: String,
    pub name: String,
    pub visited_at: u64,
}
