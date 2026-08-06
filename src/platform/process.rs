pub trait CommandNoWindowExt {
    fn no_window(&mut self) -> &mut Self;

    /// Suppress a console window without detaching the child from piped stdio.
    fn no_window_with_stdio(&mut self) -> &mut Self;
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;
#[cfg(windows)]
// GUI builds have no parent console; detach background CLI tools so Windows
// does not create transient conhost windows for each short-lived command.
const NO_CONSOLE_WINDOW_FLAGS: u32 = CREATE_NO_WINDOW | DETACHED_PROCESS;

impl CommandNoWindowExt for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl CommandNoWindowExt for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(NO_CONSOLE_WINDOW_FLAGS);
        }
        self
    }

    fn no_window_with_stdio(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}
