//! `dinotty` - command-line client for a running Dinotty instance.
//!
//! The binary intentionally keeps dependencies small (reqwest + serde +
//! dirs) and routes every command through the same HTTP client, so future
//! commands only need to add a variant to [`args::Command`] and a handler.

mod api;
mod args;
mod commands;
mod config;
mod error;
mod viewer;

use std::process::ExitCode;

use args::{Command, HelpTopic, Invocation};
use config::Config;
use error::CliError;

fn main() -> ExitCode {
    let raw: Vec<String> = std::env::args().skip(1).collect();
    match args::parse(&raw) {
        Ok(Invocation::Version) => {
            println!("dinotty {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Ok(Invocation::Help(topic)) => {
            print!("{}", help_text(topic));
            ExitCode::SUCCESS
        }
        Ok(Invocation::Run { options, command }) => {
            let json = options.json;
            match execute(&options, command) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    report(&error, json);
                    ExitCode::from(error.exit_code)
                }
            }
        }
        Err(error) => {
            report(&error, false);
            ExitCode::from(error.exit_code)
        }
    }
}

fn execute(options: &args::GlobalOptions, command: Command) -> Result<(), CliError> {
    let config = Config::from_options(options)?;
    match command {
        Command::ViewerOpen { file } => {
            let pane_id = config.require_pane()?.to_string();
            let http = api::HttpClient::connect(&config)?;
            let response = viewer::open(&http, &pane_id, &file)?;
            if options.json {
                commands::print_json(&response)?;
            } else {
                println!("{}", commands::viewer_summary(&response));
            }
        }
        Command::SessionsList => {
            let http = api::HttpClient::connect(&config)?;
            let response = commands::sessions(&http)?;
            if options.json {
                commands::print_json(&response)?;
            } else {
                // `/api/sessions` returns `tab_id: null`; enrich the table from
                // `/api/tabs` when it is available.
                let tabs = commands::tabs(&http).ok();
                println!("{}", commands::sessions_summary(&response, tabs.as_ref()));
            }
        }
        Command::TabsList => {
            let http = api::HttpClient::connect(&config)?;
            let response = commands::tabs(&http)?;
            if options.json {
                commands::print_json(&response)?;
            } else {
                println!("{}", commands::tabs_summary(&response));
            }
        }
        Command::InputSend { pane_id, text } => {
            let http = api::HttpClient::connect(&config)?;
            let response = commands::send_input(&http, &pane_id, &text)?;
            if options.json {
                commands::print_json(&response)?;
            } else {
                println!("{}", commands::input_summary(&pane_id, &text));
            }
        }
        Command::Screen { pane_id } => {
            let http = api::HttpClient::connect(&config)?;
            let response = commands::screen(&http, &pane_id, options.ansi)?;
            if options.json {
                commands::print_json(&response)?;
            } else {
                let content = commands::screen_output(&response);
                if !content.is_empty() {
                    print!("{content}");
                    if !content.ends_with('\n') {
                        println!();
                    }
                }
            }
        }
    }
    Ok(())
}

fn report(error: &CliError, json: bool) {
    if json {
        match serde_json::to_string_pretty(&error.to_json()) {
            Ok(rendered) => eprintln!("{rendered}"),
            Err(_) => eprintln!("{error}"),
        }
    } else {
        eprintln!("{error}");
    }
}

const fn help_text(topic: HelpTopic) -> &'static str {
    match topic {
        HelpTopic::General => args::general_help(),
        HelpTopic::Viewer => args::viewer_help(),
        HelpTopic::Sessions => args::sessions_help(),
        HelpTopic::Tabs => args::tabs_help(),
        HelpTopic::Input => args::input_help(),
        HelpTopic::Screen => args::screen_help(),
    }
}
