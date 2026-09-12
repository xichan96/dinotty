use portable_pty::CommandBuilder;

#[derive(Debug, PartialEq, Eq)]
struct LocalePlan {
    remove_lc_all: bool,
    remove_lc_ctype: bool,
    remove_lang: bool,
    set_lang: bool,
}

/// Apply environment variables that describe Dinotty's terminal capabilities.
///
/// `CommandBuilder` owns a snapshot of the child environment, so locale
/// decisions are made against the environment that will actually reach the
/// PTY rather than against the mutable process-wide environment.
pub fn configure_terminal_environment(cmd: &mut CommandBuilder) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "dinotty");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

    // Native Windows shells manage their own locale configuration. WSL is
    // launched by a native Windows process too, so its distribution remains
    // the authority for locale variables.
    #[cfg(not(windows))]
    apply_locale(cmd);
}

#[cfg(not(windows))]
fn apply_locale(cmd: &mut CommandBuilder) {
    let lc_all = env_value(cmd, "LC_ALL");
    let lc_ctype = env_value(cmd, "LC_CTYPE");
    let lang = env_value(cmd, "LANG");
    let plan = locale_plan_for_platform(
        lc_all.as_deref(),
        lc_ctype.as_deref(),
        lang.as_deref(),
        cfg!(target_os = "macos"),
    );

    if plan.remove_lc_all {
        cmd.env_remove("LC_ALL");
    }
    if plan.remove_lc_ctype {
        cmd.env_remove("LC_CTYPE");
    }
    if plan.remove_lang {
        cmd.env_remove("LANG");
    }
    if plan.set_lang {
        cmd.env("LANG", default_utf8_locale());
    }
}

fn env_value(cmd: &CommandBuilder, key: &str) -> Option<String> {
    cmd.get_env(key).map(|value| value.to_string_lossy().into_owned())
}

fn present(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}

// Darwin has no C.UTF-8 locale. Treating it as UTF-8 by name silently makes
// libc fall back to C, which breaks multibyte input and cursor handling.
fn known_unsupported_locale(value: &str, is_macos: bool) -> bool {
    is_macos && matches!(value.trim().to_ascii_uppercase().as_str(), "C.UTF-8" | "C.UTF8")
}

fn locale_plan_for_platform(
    lc_all: Option<&str>,
    lc_ctype: Option<&str>,
    lang: Option<&str>,
    is_macos: bool,
) -> LocalePlan {
    let remove_lc_all =
        present(lc_all).is_some_and(|value| known_unsupported_locale(value, is_macos));
    let remove_lc_ctype =
        present(lc_ctype).is_some_and(|value| known_unsupported_locale(value, is_macos));
    let remove_lang = present(lang).is_some_and(|value| known_unsupported_locale(value, is_macos));

    let usable_lc_all = present(lc_all).filter(|_| !remove_lc_all);
    let usable_lc_ctype = present(lc_ctype).filter(|_| !remove_lc_ctype);
    let usable_lang = present(lang).filter(|_| !remove_lang);

    LocalePlan {
        remove_lc_all,
        remove_lc_ctype,
        remove_lang,
        // Preserve every explicit, usable locale — including C, POSIX, and
        // non-UTF-8 choices — using the normal LC_ALL > LC_CTYPE > LANG
        // precedence. Only GUI-style absent/invalid environments get a
        // coherent UTF-8 LANG default for all locale categories.
        set_lang: usable_lc_all.is_none() && usable_lc_ctype.is_none() && usable_lang.is_none(),
    }
}

fn default_utf8_locale() -> &'static str {
    if cfg!(target_os = "macos") {
        "en_US.UTF-8"
    } else {
        "C.UTF-8"
    }
}

/// Merge PATH entries while preserving their first-seen order.
pub fn path_with_fallbacks(path: &str, fallbacks: &[&str]) -> String {
    let mut entries = Vec::new();
    for entry in path.split(':').chain(fallbacks.iter().copied()) {
        if !entries.iter().any(|known: &String| known == entry) {
            entries.push(entry.to_string());
        }
    }
    entries.join(":")
}

/// A GUI-launched macOS app has LaunchServices' minimal PATH. Cache the
/// user's login-shell PATH exclusively for direct-argv tabs; interactive
/// login shells keep the original environment and evaluate startup files once.
#[cfg(target_os = "macos")]
pub fn direct_command_path() -> Option<&'static str> {
    use std::sync::OnceLock;

    static LOGIN_SHELL_PATH: OnceLock<Option<String>> = OnceLock::new();
    LOGIN_SHELL_PATH.get_or_init(read_login_shell_path).as_deref()
}

#[cfg(not(target_os = "macos"))]
pub fn direct_command_path() -> Option<&'static str> {
    None
}

/// Prime the cached direct-command PATH during desktop startup, before the
/// runtime starts spawning PTYs. This never mutates the parent process PATH.
pub fn prime_direct_command_path() {
    let _ = direct_command_path();
}

#[cfg(target_os = "macos")]
fn read_login_shell_path() -> Option<String> {
    use crate::platform::process::CommandNoWindowExt;

    const START_MARKER: &[u8] = b"__DINOTTY_PATH_START__";
    const END_MARKER: &[u8] = b"__DINOTTY_PATH_END__";

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut command = std::process::Command::new(shell);
    command.no_window();
    let out = command
        .args(["-lc", "printf '__DINOTTY_PATH_START__%s__DINOTTY_PATH_END__' \"$PATH\""])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }

    let start = out.stdout.windows(START_MARKER.len()).position(|window| window == START_MARKER)?;
    let value_start = start + START_MARKER.len();
    let end = out.stdout[value_start..]
        .windows(END_MARKER.len())
        .position(|window| window == END_MARKER)?;
    let path = std::str::from_utf8(&out.stdout[value_start..value_start + end]).ok()?.trim();
    (!path.is_empty()).then(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use portable_pty::CommandBuilder;

    use super::{
        configure_terminal_environment, default_utf8_locale, locale_plan_for_platform,
        path_with_fallbacks, LocalePlan,
    };

    #[test]
    fn locale_preserves_explicit_locale_precedence() {
        for (all, ctype, lang) in [
            (Some("C"), Some("zh_CN.UTF-8"), Some("en_US.UTF-8")),
            (Some("POSIX"), None, None),
            (None, Some("zh_CN.GB18030"), Some("en_US.UTF-8")),
            (None, None, Some("en_US.ISO8859-1")),
        ] {
            assert_eq!(
                locale_plan_for_platform(all, ctype, lang, true),
                LocalePlan {
                    remove_lc_all: false,
                    remove_lc_ctype: false,
                    remove_lang: false,
                    set_lang: false
                }
            );
        }
    }

    #[test]
    fn locale_replaces_only_darwins_unsupported_c_utf8() {
        assert_eq!(
            locale_plan_for_platform(None, Some("C.UTF-8"), None, true),
            LocalePlan {
                remove_lc_all: false,
                remove_lc_ctype: true,
                remove_lang: false,
                set_lang: true
            }
        );
        assert_eq!(
            locale_plan_for_platform(None, Some("C.UTF-8"), None, false),
            LocalePlan {
                remove_lc_all: false,
                remove_lc_ctype: false,
                remove_lang: false,
                set_lang: false
            }
        );
    }

    #[test]
    fn locale_defaults_when_every_locale_is_missing_or_invalid() {
        assert_eq!(
            locale_plan_for_platform(Some("C.UTF8"), Some("C.UTF-8"), Some("C.UTF-8"), true),
            LocalePlan {
                remove_lc_all: true,
                remove_lc_ctype: true,
                remove_lang: true,
                set_lang: true
            }
        );
        assert_eq!(
            locale_plan_for_platform(None, None, None, true),
            LocalePlan {
                remove_lc_all: false,
                remove_lc_ctype: false,
                remove_lang: false,
                set_lang: true
            }
        );
    }

    #[test]
    fn path_deduplication_preserves_order() {
        assert_eq!(
            path_with_fallbacks(
                "/usr/bin:/opt/homebrew/bin:/usr/bin::",
                &["/opt/homebrew/bin", "/usr/local/bin"]
            ),
            "/usr/bin:/opt/homebrew/bin::/usr/local/bin"
        );
    }

    #[test]
    fn terminal_metadata_is_applied_to_the_child_environment() {
        let mut cmd = CommandBuilder::new("sh");
        cmd.env_clear();
        configure_terminal_environment(&mut cmd);

        assert_eq!(cmd.get_env("TERM").unwrap(), "xterm-256color");
        assert_eq!(cmd.get_env("COLORTERM").unwrap(), "truecolor");
        assert_eq!(cmd.get_env("TERM_PROGRAM").unwrap(), "dinotty");
        assert_eq!(cmd.get_env("TERM_PROGRAM_VERSION").unwrap(), env!("CARGO_PKG_VERSION"));

        #[cfg(not(windows))]
        assert_eq!(cmd.get_env("LANG").unwrap(), default_utf8_locale());
    }

    #[cfg(not(windows))]
    #[test]
    fn terminal_environment_preserves_explicit_lc_all() {
        let mut cmd = CommandBuilder::new("sh");
        cmd.env_clear();
        cmd.env("LC_ALL", "C");
        configure_terminal_environment(&mut cmd);

        assert_eq!(cmd.get_env("LC_ALL").unwrap(), "C");
        assert!(cmd.get_env("LANG").is_none());
    }
}
