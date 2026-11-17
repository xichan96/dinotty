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
    ViewerOpen { file: PathBuf },
    SessionsList,
    TabsList,
    InputSend { pane_id: String, text: String },
    Screen { pane_id: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HelpTopic {
    General,
    Viewer,
    Sessions,
    Tabs,
    Input,
    Screen,
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
            "--url" | "--pane" | "--token" => {
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| CliError::usage(format!("{arg} requires a value")))?;
                set_option(&mut options, arg, value.clone())?;
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

    let command = command_from_positionals(&positionals, &options)?;
    Ok(Invocation::Run { options, command })
}

fn set_option(options: &mut GlobalOptions, name: &str, value: String) -> Result<(), CliError> {
    if value.is_empty() {
        return Err(CliError::usage(format!("{name} must not be empty")));
    }
    match name {
        "--url" => options.url = Some(value),
        "--pane" => options.pane = Some(value),
        "--token" => options.token = Some(value),
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
) -> Result<Command, CliError> {
    let missing =
        |what: &str| CliError::usage(format!("missing {what}\nRun `dinotty --help` for usage."));
    match positionals {
        [group, action, rest @ ..] if group == "viewer" && action == "open" => {
            let file = rest.first().ok_or_else(|| missing("file path"))?;
            if rest.len() > 1 {
                return Err(CliError::usage("viewer open accepts exactly one file path"));
            }
            Ok(Command::ViewerOpen { file: PathBuf::from(file) })
        }
        [group, action] if group == "sessions" && action == "list" => Ok(Command::SessionsList),
        [group, action] if group == "tabs" && action == "list" => Ok(Command::TabsList),
        [group, action, rest @ ..] if group == "input" && action == "send" => match rest {
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
        },
        [group, rest @ ..] if group == "screen" => match rest {
            [pane_id] => Ok(Command::Screen { pane_id: pane_id.clone() }),
            [] => match options.pane.clone() {
                Some(pane_id) => Ok(Command::Screen { pane_id }),
                None => Err(missing("pane id (or set --pane / DINOTTY_PANE_ID)")),
            },
            _ => Err(CliError::usage("screen accepts exactly one pane id")),
        },
        [] => Err(CliError::usage("no command given\nRun `dinotty --help` for usage.")),
        [first, ..]
            if matches!(first.as_str(), "viewer" | "sessions" | "tabs" | "input" | "screen") =>
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

fn help_topic(positionals: &[String]) -> HelpTopic {
    match positionals.first().map(String::as_str) {
        Some("viewer") => HelpTopic::Viewer,
        Some("sessions") => HelpTopic::Sessions,
        Some("tabs") => HelpTopic::Tabs,
        Some("input") => HelpTopic::Input,
        Some("screen") => HelpTopic::Screen,
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
  tabs list                     List tabs
  input send <pane_id> <text>   Send text to a terminal pane
  screen <pane_id>              Print a terminal pane's screen

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
    "dinotty tabs - inspect tabs

Usage:
  dinotty [GLOBAL OPTIONS] tabs list
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
    }
}
