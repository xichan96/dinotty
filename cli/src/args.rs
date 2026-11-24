//! Command-line parsing. Hand-rolled to keep the CLI dependency-light; the
//! surface is intentionally small and documented in `docs/dinotty-cli.md`.

use std::path::PathBuf;

use crate::error::CliError;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GlobalOptions {
    pub url: Option<String>,
    pub pane: Option<String>,
    pub token: Option<String>,
    pub json: bool,
    pub ansi: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    ViewerOpen {
        file: PathBuf,
    },
    SessionsList,
    TabsList,
    TabsCreate {
        cwd: Option<PathBuf>,
        title: Option<String>,
        env: Vec<(String, String)>,
        argv: Vec<String>,
    },
    TabsClose {
        tab_id: String,
    },
    TabsRename {
        tab_id: String,
        title: String,
    },
    TabsSplit {
        tab_id: String,
        pane_id: Option<String>,
        direction: String,
        cwd: Option<PathBuf>,
    },
    TabsActivate {
        tab_id: String,
        pane_id: Option<String>,
    },
    InputSend {
        pane_id: String,
        text: String,
    },
    Screen {
        pane_id: String,
    },
    WorkspaceList {
        path: String,
    },
    WorkspaceRead {
        path: String,
    },
    WorkspaceWrite {
        path: String,
    },
    WorkspaceGitStatus,
    WorkspaceGitDiff {
        path: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelpTopic {
    General,
    Viewer,
    Sessions,
    Tabs,
    Input,
    Screen,
    Workspace,
}

/// Command-specific options. The global parser recognises them anywhere so
/// they can follow the command (the common style), then each command rejects
/// the ones it does not accept.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandOptions {
    pub cwd: Option<String>,
    pub title: Option<String>,
    pub env: Vec<String>,
    pub direction: Option<String>,
}

impl CommandOptions {
    fn ensure_empty(&self, command: &str) -> Result<(), CliError> {
        let mut unused = Vec::new();
        if self.cwd.is_some() {
            unused.push("--cwd");
        }
        if self.title.is_some() {
            unused.push("--title");
        }
        if !self.env.is_empty() {
            unused.push("--env");
        }
        if self.direction.is_some() {
            unused.push("--direction");
        }
        if unused.is_empty() {
            Ok(())
        } else {
            Err(CliError::usage(format!("{} does not accept {}", command, unused.join(", "))))
        }
    }
}

fn env_assignments(raw: &[String]) -> Result<Vec<(String, String)>, CliError> {
    raw.iter()
        .map(|assignment| {
            let (key, value) = assignment.split_once('=').ok_or_else(|| {
                CliError::usage(format!("--env expects KEY=VALUE, got {assignment:?}"))
            })?;
            if key.trim().is_empty() {
                return Err(CliError::usage("--env key must not be empty"));
            }
            Ok((key.to_string(), value.to_string()))
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Invocation {
    Run { options: GlobalOptions, command: Command },
    Help(HelpTopic),
    Version,
}

/// Parse `args` (without the program name).
///
/// # Errors
/// Returns a usage error for unknown options, missing option values, and
/// commands that do not match the documented shapes.
pub fn parse(args: &[String]) -> Result<Invocation, CliError> {
    let mut options = GlobalOptions::default();
    let mut command_options = CommandOptions::default();
    let mut positionals = Vec::new();
    let mut help = false;
    let mut version = false;
    let mut index = 0;
    let mut only_positionals = false;

    while index < args.len() {
        let arg = &args[index];
        if only_positionals {
            positionals.push(arg.clone());
            index += 1;
            continue;
        }
        match arg.as_str() {
            "--" => only_positionals = true,
            "-h" | "--help" => help = true,
            "-V" | "--version" => version = true,
            "--json" => options.json = true,
            "--ansi" => options.ansi = true,
            "--url" | "--pane" | "--token" | "--cwd" | "--title" | "--env" | "--direction" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::usage(format!("{arg} requires a value")))?;
                set_option(&mut options, &mut command_options, arg, value.clone())?;
                index += 1;
            }
            other if other.starts_with("--url=") => {
                options.url = Some(strip_option_value("--url", other)?.to_string());
            }
            other if other.starts_with("--pane=") => {
                options.pane = Some(strip_option_value("--pane", other)?.to_string());
            }
            other if other.starts_with("--token=") => {
                options.token = Some(strip_option_value("--token", other)?.to_string());
            }
            other if other.starts_with("--cwd=") => {
                command_options.cwd = Some(strip_option_value("--cwd", other)?.to_string());
            }
            other if other.starts_with("--title=") => {
                command_options.title = Some(strip_option_value("--title", other)?.to_string());
            }
            other if other.starts_with("--env=") => {
                command_options.env.push(strip_option_value("--env", other)?.to_string());
            }
            other if other.starts_with("--direction=") => {
                command_options.direction =
                    Some(strip_option_value("--direction", other)?.to_string());
            }
            other if other.starts_with('-') && other != "-" => {
                return Err(CliError::usage(format!(
                    "unknown option: {other}\nRun `dinotty --help` for usage."
                )));
            }
            other => positionals.push(other.to_string()),
        }
        index += 1;
    }

    if version {
        return Ok(Invocation::Version);
    }
    if help {
        return Ok(Invocation::Help(help_topic(&positionals)));
    }

    let command = command_from_positionals(&positionals, &options, &command_options)?;
    Ok(Invocation::Run { options, command })
}

fn set_option(
    options: &mut GlobalOptions,
    command_options: &mut CommandOptions,
    name: &str,
    value: String,
) -> Result<(), CliError> {
    if value.is_empty() {
        return Err(CliError::usage(format!("{name} must not be empty")));
    }
    match name {
        "--url" => options.url = Some(value),
        "--pane" => options.pane = Some(value),
        "--token" => options.token = Some(value),
        "--cwd" => command_options.cwd = Some(value),
        "--title" => command_options.title = Some(value),
        "--env" => command_options.env.push(value),
        "--direction" => command_options.direction = Some(value),
        _ => return Err(CliError::usage(format!("unknown option: {name}"))),
    }
    Ok(())
}

fn strip_option_value<'a>(name: &str, arg: &'a str) -> Result<&'a str, CliError> {
    let value = &arg[name.len() + 1..];
    if value.is_empty() {
        Err(CliError::usage(format!("{name} must not be empty")))
    } else {
        Ok(value)
    }
}

fn command_from_positionals(
    positionals: &[String],
    options: &GlobalOptions,
    command_options: &CommandOptions,
) -> Result<Command, CliError> {
    let missing =
        |what: &str| CliError::usage(format!("missing {what}\nRun `dinotty --help` for usage."));
    match positionals {
        [group, action, rest @ ..] if group == "viewer" && action == "open" => {
            command_options.ensure_empty("viewer open")?;
            let file = rest.first().ok_or_else(|| missing("file path"))?;
            if rest.len() > 1 {
                return Err(CliError::usage("viewer open accepts exactly one file path"));
            }
            Ok(Command::ViewerOpen { file: PathBuf::from(file) })
        }
        [group, action] if group == "sessions" && action == "list" => {
            command_options.ensure_empty("sessions list")?;
            Ok(Command::SessionsList)
        }
        [group, action] if group == "tabs" && action == "list" => {
            command_options.ensure_empty("tabs list")?;
            Ok(Command::TabsList)
        }
        [group, action, rest @ ..] if group == "tabs" && action == "create" => {
            if command_options.direction.is_some() {
                return Err(CliError::usage("tabs create does not accept --direction"));
            }
            let env = env_assignments(&command_options.env)?;
            if !env.is_empty() && rest.is_empty() {
                return Err(CliError::usage(
                    "--env requires an argv command after `--`, e.g. -- env KEY=VALUE claude",
                ));
            }
            if rest.first().is_some_and(String::is_empty) {
                return Err(CliError::usage("argv[0] must not be empty"));
            }
            Ok(Command::TabsCreate {
                cwd: command_options.cwd.clone().map(PathBuf::from),
                title: command_options.title.clone().filter(|title| !title.trim().is_empty()),
                env,
                argv: rest.to_vec(),
            })
        }
        [group, action, tab_id] if group == "tabs" && action == "close" => {
            command_options.ensure_empty("tabs close")?;
            Ok(Command::TabsClose { tab_id: tab_id.clone() })
        }
        [group, action, rest @ ..] if group == "tabs" && action == "rename" => {
            if command_options.cwd.is_some()
                || !command_options.env.is_empty()
                || command_options.direction.is_some()
            {
                return Err(CliError::usage(
                    "tabs rename accepts only the tab id, a title, and --title",
                ));
            }
            let tab_id = rest.first().ok_or_else(|| missing("tab id"))?;
            let title = rest
                .get(1)
                .cloned()
                .or_else(|| command_options.title.clone())
                .ok_or_else(|| missing("title"))?;
            if rest.len() > 2 {
                return Err(CliError::usage("tabs rename accepts one tab id and one title"));
            }
            if title.trim().is_empty() {
                return Err(CliError::usage("title must not be empty"));
            }
            Ok(Command::TabsRename { tab_id: tab_id.clone(), title })
        }
        [group, action, rest @ ..] if group == "tabs" && action == "split" => {
            if command_options.title.is_some() || !command_options.env.is_empty() {
                return Err(CliError::usage(
                    "tabs split accepts --direction and --cwd, not --title/--env",
                ));
            }
            let tab_id = rest.first().ok_or_else(|| missing("tab id"))?;
            if rest.len() > 1 {
                return Err(CliError::usage("tabs split accepts exactly one tab id"));
            }
            let raw_direction = command_options
                .direction
                .as_deref()
                .ok_or_else(|| missing("--direction horizontal|vertical"))?;
            let direction = normalize_direction(raw_direction)?;
            Ok(Command::TabsSplit {
                tab_id: tab_id.clone(),
                pane_id: options.pane.clone(),
                direction,
                cwd: command_options.cwd.clone().map(PathBuf::from),
            })
        }
        [group, action, rest @ ..] if group == "tabs" && action == "activate" => {
            command_options.ensure_empty("tabs activate")?;
            let tab_id = rest.first().ok_or_else(|| missing("tab id"))?;
            if rest.len() > 2 {
                return Err(CliError::usage(
                    "tabs activate accepts a tab id and an optional pane id",
                ));
            }
            let pane_id = rest.get(1).cloned().or_else(|| options.pane.clone());
            Ok(Command::TabsActivate { tab_id: tab_id.clone(), pane_id })
        }
        [group, action, rest @ ..] if group == "input" && action == "send" => {
            command_options.ensure_empty("input send")?;
            match rest {
                [pane_id, text] => {
                    Ok(Command::InputSend { pane_id: pane_id.clone(), text: text.clone() })
                }
                [text] => match options.pane.clone() {
                    Some(pane_id) => Ok(Command::InputSend { pane_id, text: text.clone() }),
                    // Without a default pane a lone argument is read as the pane
                    // id, which is the older two-argument form missing its text.
                    None => Err(missing("text to send")),
                },
                [] => Err(missing("text to send")),
                _ => Err(CliError::usage(
                    "input send accepts a pane id and one text argument; quote the text",
                )),
            }
        }
        [group, rest @ ..] if group == "screen" => {
            command_options.ensure_empty("screen")?;
            match rest {
                [pane_id] => Ok(Command::Screen { pane_id: pane_id.clone() }),
                [] => match options.pane.clone() {
                    Some(pane_id) => Ok(Command::Screen { pane_id }),
                    None => Err(missing("pane id (or set --pane / DINOTTY_PANE_ID)")),
                },
                _ => Err(CliError::usage("screen accepts exactly one pane id")),
            }
        }
        [group, action, rest @ ..] if group == "workspace" && action == "list" => {
            command_options.ensure_empty("workspace list")?;
            if rest.len() > 1 {
                return Err(CliError::usage("workspace list accepts at most one path"));
            }
            Ok(Command::WorkspaceList { path: rest.first().cloned().unwrap_or_default() })
        }
        [group, action, path] if group == "workspace" && action == "read" => {
            command_options.ensure_empty("workspace read")?;
            Ok(Command::WorkspaceRead { path: path.clone() })
        }
        [group, action, _path] if group == "workspace" && action == "write" => {
            Err(CliError::usage("workspace write reads from stdin: pass the path followed by `-`"))
        }
        [group, action, path, dash @ ..] if group == "workspace" && action == "write" => {
            command_options.ensure_empty("workspace write")?;
            if dash.len() != 1 || dash[0] != "-" {
                return Err(CliError::usage(
                    "workspace write reads from stdin: pass the path followed by `-`",
                ));
            }
            Ok(Command::WorkspaceWrite { path: path.clone() })
        }
        [group, action, sub, rest @ ..] if group == "workspace" && action == "git" => {
            command_options.ensure_empty("workspace git")?;
            match (sub.as_str(), rest) {
                ("status", []) => Ok(Command::WorkspaceGitStatus),
                ("diff", [path]) => Ok(Command::WorkspaceGitDiff { path: path.clone() }),
                ("diff", []) => Err(missing("path for `workspace git diff`")),
                ("diff", _) => Err(CliError::usage("workspace git diff accepts one path")),
                _ => Err(CliError::usage(format!(
                    "unknown workspace git command: {sub}\nRun `dinotty workspace --help` for usage."
                ))),
            }
        }
        [group, action]
            if group == "tabs"
                && matches!(action.as_str(), "close" | "rename" | "split" | "activate") =>
        {
            Err(CliError::usage(format!(
                "missing tab id for `tabs {action}`\nRun `dinotty tabs --help` for usage."
            )))
        }
        [] => Err(CliError::usage("no command given\nRun `dinotty --help` for usage.")),
        [first, ..]
            if matches!(
                first.as_str(),
                "viewer" | "sessions" | "tabs" | "input" | "screen" | "workspace"
            ) =>
        {
            Err(CliError::usage(format!(
                "unknown {} command: {}\nRun `dinotty {first} --help` for usage.",
                first,
                positionals[1..].join(" ")
            )))
        }
        _ => Err(CliError::usage(format!(
            "unknown command: {}\nRun `dinotty --help` for usage.",
            positionals.join(" ")
        ))),
    }
}

fn normalize_direction(raw: &str) -> Result<String, CliError> {
    match raw.to_ascii_lowercase().as_str() {
        "h" | "horizontal" => Ok("horizontal".to_string()),
        "v" | "vertical" => Ok("vertical".to_string()),
        _ => {
            Err(CliError::usage(format!("invalid --direction {raw:?}: use horizontal or vertical")))
        }
    }
}

fn help_topic(positionals: &[String]) -> HelpTopic {
    match positionals.first().map(String::as_str) {
        Some("viewer") => HelpTopic::Viewer,
        Some("sessions") => HelpTopic::Sessions,
        Some("tabs") => HelpTopic::Tabs,
        Some("input") => HelpTopic::Input,
        Some("screen") => HelpTopic::Screen,
        Some("workspace") => HelpTopic::Workspace,
        _ => HelpTopic::General,
    }
}

#[must_use]
pub const fn general_help() -> &'static str {
    "dinotty - command-line client for a running Dinotty instance

Usage:
  dinotty [GLOBAL OPTIONS] <COMMAND>

Commands:
  viewer open <file>            Open a file in the main UI's file viewer
  sessions list                 List terminal sessions
  tabs list|create|close|rename|split|activate
                                Inspect and manage tabs and panes
  input send <pane_id> <text>   Send text to a terminal pane
  screen <pane_id>              Print a terminal pane's screen
  workspace list|read|write|git
                                List, read, write, and diff workspace files

Global options:
  --url <URL>       Dinotty base URL (env: DINOTTY_URL; default: http://127.0.0.1:8999)
  --pane <ID>       Pane id (env: DINOTTY_PANE_ID)
  --token <TOKEN>   Auth token (env: DINOTTY_TOKEN, then /api/auto-token, then the token file)
  --json            Print machine-readable JSON
  --ansi            With `screen`: return ANSI instead of plain text
  -h, --help        Show help (append to a command for command help)
  -V, --version     Show the version

Environment:
  DINOTTY_URL       Base URL, overridden by --url
  DINOTTY_PANE_ID   Default pane id, overridden by --pane
  DINOTTY_TOKEN     Auth token, overridden by --token
  DINOTTY_CONFIG_SUFFIX  Config-directory suffix used when locating the token file

Exit codes: 0 success, 1 API/runtime error, 2 usage error.
Docs: docs/dinotty-cli.md
"
}

#[must_use]
pub const fn viewer_help() -> &'static str {
    "dinotty viewer - open files in the main UI

Usage:
  dinotty [GLOBAL OPTIONS] viewer open <file>

`viewer open` resolves the pane's workspace with GET /api/workspace/cwd and
then POSTs /api/sessions/<pane>/viewer with a workspace-relative path. A file
outside the workspace is first copied to <workspace>/.claude/artifacts/.

The pane id comes from --pane or DINOTTY_PANE_ID. Global options apply.
"
}

#[must_use]
pub const fn sessions_help() -> &'static str {
    "dinotty sessions - inspect terminal sessions

Usage:
  dinotty [GLOBAL OPTIONS] sessions list

Requires the server's Open API to be enabled (Settings -> Open API).
"
}

#[must_use]
pub const fn tabs_help() -> &'static str {
    "dinotty tabs - inspect and manage tabs

Usage:
  dinotty [GLOBAL OPTIONS] tabs list
  dinotty [GLOBAL OPTIONS] tabs create [--cwd <dir>] [--title <title>] [--env KEY=V]... [-- <argv>...]
  dinotty [GLOBAL OPTIONS] tabs close <tab_id>
  dinotty [GLOBAL OPTIONS] tabs rename <tab_id> <title>
  dinotty [GLOBAL OPTIONS] tabs split <tab_id> --direction horizontal|vertical [--pane <id>] [--cwd <dir>]
  dinotty [GLOBAL OPTIONS] tabs activate <tab_id> [pane_id]

`tabs create` posts the argv verbatim to POST /api/tabs. Without an argv the
server opens the user's default shell. `--env KEY=VALUE` prefixes the argv with
/usr/bin/env assignments (POSIX only) because the HTTP API has no env field.

`tabs split` needs a target pane; it defaults to the tab's first pane. Like
`screen`, these commands do not require Open API, only the server token.
"
}

#[must_use]
pub const fn workspace_help() -> &'static str {
    "dinotty workspace - read and edit files under a pane's workspace

Usage:
  dinotty [GLOBAL OPTIONS] workspace list [<path>]
  dinotty [GLOBAL OPTIONS] workspace read <path>
  dinotty [GLOBAL OPTIONS] workspace write <path> -
  dinotty [GLOBAL OPTIONS] workspace git status
  dinotty [GLOBAL OPTIONS] workspace git diff <path>

Paths are relative to the pane workspace (leading slashes are stripped and
`..` is rejected by the server). The pane comes from --pane or
DINOTTY_PANE_ID. `workspace read` streams raw bytes to stdout; --json fetches
the text preview from /api/workspace/meta (capped at 512 KiB). `workspace
write` reads its content from stdin and requires a trailing `-`.
"
}

#[must_use]
pub const fn input_help() -> &'static str {
    "dinotty input - send text to a terminal

Usage:
  dinotty [GLOBAL OPTIONS] input send <pane_id> <text>

Requires the server's Open API to be enabled (Settings -> Open API). The text
is written verbatim; add a trailing newline by quoting it, e.g. \"ls\\n\".
With --pane or DINOTTY_PANE_ID set, the pane argument may be omitted.
"
}

#[must_use]
pub const fn screen_help() -> &'static str {
    "dinotty screen - print a terminal pane's screen

Usage:
  dinotty [GLOBAL OPTIONS] screen [<pane_id>]

Pass --ansi to keep escape sequences; the default is plain text. The pane id
may also come from --pane or DINOTTY_PANE_ID.

Requires the server's Open API to be enabled (Settings -> Open API).
"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_ok(args: &[&str]) -> Invocation {
        parse(&args.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>()).unwrap()
    }

    fn parse_err(args: &[&str]) -> String {
        parse(&args.iter().map(|arg| (*arg).to_string()).collect::<Vec<_>>()).unwrap_err().message
    }

    #[test]
    fn parses_viewer_open_with_file() {
        let Invocation::Run { command, .. } = parse_ok(&["viewer", "open", "a.html"]) else {
            panic!("expected a command");
        };
        assert_eq!(command, Command::ViewerOpen { file: PathBuf::from("a.html") });
    }

    #[test]
    fn parses_global_options_before_and_after_the_command() {
        let Invocation::Run { options, command } = parse_ok(&[
            "--url",
            "http://example.test:9000",
            "viewer",
            "open",
            "a.html",
            "--pane",
            "pane-1",
            "--json",
        ]) else {
            panic!("expected a command");
        };
        assert_eq!(options.url.as_deref(), Some("http://example.test:9000"));
        assert_eq!(options.pane.as_deref(), Some("pane-1"));
        assert!(options.json);
        assert!(matches!(command, Command::ViewerOpen { .. }));
    }

    #[test]
    fn supports_equals_form_options() {
        let Invocation::Run { options, .. } = parse_ok(&["--token=secret", "sessions", "list"])
        else {
            panic!("expected a command");
        };
        assert_eq!(options.token.as_deref(), Some("secret"));
    }

    #[test]
    fn rejects_unknown_options_and_missing_values() {
        assert!(parse_err(&["--bogus", "sessions", "list"]).contains("unknown option"));
        assert!(parse_err(&["--url"]).contains("requires a value"));
        assert!(parse_err(&["--url="]).contains("must not be empty"));
    }

    #[test]
    fn requires_the_viewer_file() {
        assert!(parse_err(&["viewer", "open"]).contains("missing file path"));
        assert!(parse_err(&["viewer", "open", "a", "b"]).contains("exactly one file path"));
    }

    #[test]
    fn supports_help_for_each_command() {
        assert_eq!(parse_ok(&["--help"]), Invocation::Help(HelpTopic::General));
        assert_eq!(parse_ok(&["viewer", "open", "--help"]), Invocation::Help(HelpTopic::Viewer));
        assert_eq!(parse_ok(&["sessions", "list", "-h"]), Invocation::Help(HelpTopic::Sessions));
        assert_eq!(parse_ok(&["tabs", "--help"]), Invocation::Help(HelpTopic::Tabs));
        assert_eq!(parse_ok(&["input", "--help"]), Invocation::Help(HelpTopic::Input));
        assert_eq!(parse_ok(&["screen", "--help"]), Invocation::Help(HelpTopic::Screen));
    }

    #[test]
    fn parses_screen_with_explicit_or_default_pane() {
        assert_eq!(
            parse_ok(&["screen", "pane-1"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::Screen { pane_id: "pane-1".into() },
            }
        );
        assert_eq!(
            parse_ok(&["--pane", "pane-2", "--ansi", "screen"]),
            Invocation::Run {
                options: GlobalOptions {
                    pane: Some("pane-2".into()),
                    ansi: true,
                    ..GlobalOptions::default()
                },
                command: Command::Screen { pane_id: "pane-2".into() },
            }
        );
    }

    #[test]
    fn parses_input_send_text_verbatim() {
        assert_eq!(
            parse_ok(&["input", "send", "pane-1", "echo hi"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::InputSend { pane_id: "pane-1".into(), text: "echo hi".into() },
            }
        );
        assert!(parse_err(&["input", "send", "pane-1"]).contains("missing text"));
        assert_eq!(
            parse_ok(&["--pane", "pane-2", "input", "send", "hi"]),
            Invocation::Run {
                options: GlobalOptions { pane: Some("pane-2".into()), ..GlobalOptions::default() },
                command: Command::InputSend { pane_id: "pane-2".into(), text: "hi".into() },
            }
        );
    }

    #[test]
    fn double_dash_allows_dash_prefixed_paths() {
        let Invocation::Run { command, .. } = parse_ok(&["viewer", "open", "--", "-notes.html"])
        else {
            panic!("expected a command");
        };
        assert_eq!(command, Command::ViewerOpen { file: PathBuf::from("-notes.html") });
    }

    #[test]
    fn reports_unknown_commands_and_subcommands() {
        assert!(parse_err(&[]).contains("no command given"));
        assert!(parse_err(&["frobnicate"]).contains("unknown command"));
        assert!(parse_err(&["viewer", "close"]).contains("unknown viewer command"));
        assert!(parse_err(&["workspace", "nope"]).contains("unknown workspace command"));
    }

    #[test]
    fn parses_tabs_create_with_options_and_argv() {
        assert_eq!(
            parse_ok(&[
                "tabs",
                "create",
                "--cwd",
                "/tmp/work",
                "--title",
                "agent",
                "--env",
                "A=1",
                "--env=B=two",
                "--",
                "claude",
                "--model",
                "x",
            ]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::TabsCreate {
                    cwd: Some(PathBuf::from("/tmp/work")),
                    title: Some("agent".into()),
                    env: vec![("A".into(), "1".into()), ("B".into(), "two".into())],
                    argv: vec!["claude".into(), "--model".into(), "x".into()],
                },
            }
        );
    }

    #[test]
    fn tabs_create_without_argv_uses_the_server_default_shell() {
        let Invocation::Run { command, .. } = parse_ok(&["tabs", "create", "--cwd", "."]) else {
            panic!("expected a command");
        };
        assert_eq!(
            command,
            Command::TabsCreate {
                cwd: Some(PathBuf::from(".")),
                title: None,
                env: Vec::new(),
                argv: Vec::new(),
            }
        );
    }

    #[test]
    fn tabs_create_validates_env_and_direction() {
        assert!(
            parse_err(&["tabs", "create", "--env", "NO_EQUALS", "--", "sh"]).contains("KEY=VALUE")
        );
        assert!(parse_err(&["tabs", "create", "--env", "A=1"]).contains("requires an argv"));
        assert!(
            parse_err(&["tabs", "create", "--env", "=1", "--", "sh"]).contains("must not be empty")
        );
        assert!(parse_err(&["tabs", "create", "--direction", "h"]).contains("does not accept"));
    }

    #[test]
    fn parses_tab_management_commands() {
        assert_eq!(
            parse_ok(&["tabs", "close", "tab-1"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::TabsClose { tab_id: "tab-1".into() },
            }
        );
        assert_eq!(
            parse_ok(&["tabs", "rename", "tab-1", "build"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::TabsRename { tab_id: "tab-1".into(), title: "build".into() },
            }
        );
        assert_eq!(
            parse_ok(&["tabs", "rename", "tab-1", "--title", "build"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::TabsRename { tab_id: "tab-1".into(), title: "build".into() },
            }
        );
        assert_eq!(
            parse_ok(&[
                "--pane",
                "pane-1",
                "tabs",
                "split",
                "tab-1",
                "--direction",
                "v",
                "--cwd",
                "/tmp",
            ]),
            Invocation::Run {
                options: GlobalOptions { pane: Some("pane-1".into()), ..GlobalOptions::default() },
                command: Command::TabsSplit {
                    tab_id: "tab-1".into(),
                    pane_id: Some("pane-1".into()),
                    direction: "vertical".into(),
                    cwd: Some(PathBuf::from("/tmp")),
                },
            }
        );
        assert_eq!(
            parse_ok(&["tabs", "activate", "tab-1", "pane-2"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::TabsActivate {
                    tab_id: "tab-1".into(),
                    pane_id: Some("pane-2".into()),
                },
            }
        );
    }

    #[test]
    fn tab_management_commands_require_their_arguments() {
        assert!(parse_err(&["tabs", "close"]).contains("missing tab id"));
        assert!(parse_err(&["tabs", "rename", "tab-1"]).contains("missing title"));
        assert!(parse_err(&["tabs", "split", "tab-1"]).contains("missing --direction"));
        assert!(parse_err(&["tabs", "split", "tab-1", "--direction", "diagonal"])
            .contains("invalid --direction"));
        assert!(parse_err(&["tabs", "activate"]).contains("missing tab id"));
    }

    #[test]
    fn parses_workspace_commands() {
        assert_eq!(
            parse_ok(&["workspace", "list"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceList { path: String::new() },
            }
        );
        assert_eq!(
            parse_ok(&["workspace", "list", "src"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceList { path: "src".into() },
            }
        );
        assert_eq!(
            parse_ok(&["workspace", "read", "Cargo.toml"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceRead { path: "Cargo.toml".into() },
            }
        );
        assert_eq!(
            parse_ok(&["workspace", "write", "a.txt", "-"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceWrite { path: "a.txt".into() },
            }
        );
        assert_eq!(
            parse_ok(&["workspace", "git", "status"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceGitStatus,
            }
        );
        assert_eq!(
            parse_ok(&["workspace", "git", "diff", "a.txt"]),
            Invocation::Run {
                options: GlobalOptions::default(),
                command: Command::WorkspaceGitDiff { path: "a.txt".into() },
            }
        );
    }

    #[test]
    fn workspace_write_requires_stdin_marker() {
        assert!(parse_err(&["workspace", "write", "a.txt"]).contains("reads from stdin"));
        assert!(parse_err(&["workspace", "write", "a.txt", "content"]).contains("reads from stdin"));
        assert!(parse_err(&["workspace", "git", "diff"]).contains("missing path"));
        assert!(parse_err(&["workspace", "git", "log"]).contains("unknown workspace git"));
        assert!(parse_err(&["workspace", "read"]).contains("unknown workspace command"));
    }

    #[test]
    fn command_options_are_rejected_by_unrelated_commands() {
        assert!(parse_err(&["sessions", "list", "--cwd", "/tmp"]).contains("does not accept"));
        assert!(
            parse_err(&["viewer", "open", "a.html", "--env", "A=1"]).contains("does not accept")
        );
    }
}
