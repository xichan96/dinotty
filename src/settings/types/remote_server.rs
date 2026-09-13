use serde::{Deserialize, Serialize};

use super::ssh::SensitiveString;

/// A dinotty server this hub can relay to.
///
/// The roster lives in the hub's `settings.json`; `id` is the stable key the
/// relay prefix (`/__srv/<id>/…`) addresses. `url` is normalized to an origin
/// (no `user:pass@`, no `ws://`, no path) - see the relay gate in
/// `crate::proxy::relay`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RemoteServer {
    pub id: String,
    pub name: String,
    pub url: String,
    /// Three states on the way in, which is why this is not a bare
    /// `SensitiveString`:
    ///
    /// | PUT payload   | deserialized  | meaning                       |
    /// |---------------|---------------|-------------------------------|
    /// | key absent    | `None`        | keep the token stored for `id` |
    /// | `""`          | `Some("")`    | clear it                      |
    /// | `"abc"`       | `Some("abc")` | set it                        |
    ///
    /// `SensitiveString`'s own `Deserialize` is an unconditional
    /// `String::deserialize`, so `""` would round-trip as an empty string
    /// rather than as "absent" - and a full-object PUT from the frontend would
    /// then silently wipe every configured token.
    ///
    /// On the way out this field serializes like any other, deliberately: the
    /// hub has no credential store besides `settings.json`, so a token that is
    /// not written there is a token the user has to re-paste on every restart.
    /// `skip_serializing` looks like it would keep GET from echoing the secret,
    /// but it cannot tell "writing to disk" apart from "writing to a response" -
    /// both go through this one `Serialize` impl - so it silently disabled
    /// persistence too.
    ///
    /// Keeping it out of *responses* is therefore a separate step, done by
    /// [`Self::scrub_secrets`] on every handler that returns settings or a
    /// roster. Anything that serializes a `Settings` into a response must go
    /// through that; `settings.json` must not.
    ///
    /// `skip_serializing_if` is what makes a scrubbed token read as *absent*
    /// rather than as `null`. A client that got `"token": null` back and echoed
    /// it would be sending the "keep" state either way, so this is not a
    /// correctness fix - it just keeps the response byte-identical to what
    /// `skip_serializing` used to produce, and stops a secret-shaped key from
    /// appearing at all.
    ///
    /// Note on `"token": null`: serde's `Option` consumes an explicit `null` as
    /// `None`, so it means **keep**, not clear. Only `""` clears. That is the
    /// safe direction - a client that hand-writes `null` preserves a working
    /// credential instead of destroying it - and it is pinned by
    /// `explicit_null_means_keep_not_clear` below.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<SensitiveString>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub last_seen_version: Option<String>,
    /// Derived from `token` - never trusted from the client. GET handlers
    /// recompute it; PUT handlers recompute it after the token merge.
    #[serde(default)]
    pub has_token: bool,
}

impl RemoteServer {
    /// Recompute the derived `has_token` flag from the token itself.
    pub fn refresh_has_token(&mut self) {
        self.has_token = self.token.as_ref().is_some_and(|t| !t.is_empty());
    }

    /// Remove the token, leaving `has_token` as the only trace of it.
    ///
    /// The counterpart to `token` serializing normally: this is what keeps the
    /// secret out of an HTTP response without also keeping it off disk. The
    /// flag is recomputed first, because after the drop there is nothing left
    /// to derive it from.
    ///
    /// Every response that carries a `RemoteServer` has to run this. It is
    /// idempotent, so a caller may apply it to a value that already went
    /// through it.
    pub fn scrub_secrets(&mut self) {
        self.refresh_has_token();
        self.token = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_token_key_deserializes_to_none() {
        let srv: RemoteServer =
            serde_json::from_str(r#"{"id":"a","name":"A","url":"http://192.168.1.5:58901"}"#)
                .unwrap();
        assert!(srv.token.is_none());
        assert!(!srv.has_token);
    }

    #[test]
    fn empty_string_token_deserializes_to_some_empty() {
        let srv: RemoteServer =
            serde_json::from_str(r#"{"id":"a","name":"A","url":"http://h:1","token":""}"#).unwrap();
        assert_eq!(srv.token.as_ref().map(SensitiveString::expose), Some(""));
    }

    /// serde's `Option` consumes an explicit `null` as `None`, *not* as
    /// `Some("")`. So `null` means "keep", while `""` means "clear" - the safe
    /// direction, but it is a deviation from the design doc's tri-state table
    /// and would be easy to "fix" into a credential-destroying regression.
    #[test]
    fn explicit_null_means_keep_not_clear() {
        let srv: RemoteServer =
            serde_json::from_str(r#"{"id":"a","name":"A","url":"http://h:1","token":null}"#)
                .unwrap();
        assert!(srv.token.is_none());
    }

    /// The token must survive a plain serialization, because that is the exact
    /// call `save_settings` makes. `skip_serializing` used to hide the secret
    /// from responses by hiding it from the settings file too, so a restart
    /// forgot every token the user had pasted.
    #[test]
    fn token_is_serialized_so_it_can_be_persisted() {
        let srv = RemoteServer {
            id: "a".into(),
            name: "A".into(),
            url: "http://h:1".into(),
            token: Some(SensitiveString::new("secret".into())),
            ..RemoteServer::default()
        };
        let json = serde_json::to_string(&srv).unwrap();
        assert!(json.contains(r#""token":"secret""#), "the token must be written: {json}");
    }

    /// Scrubbing is what keeps the secret out of a response. Dropping the token
    /// must not drop `has_token` with it - the flag is the only thing a client
    /// is allowed to learn, so it has to be derived before the token goes away.
    #[test]
    fn scrub_secrets_removes_the_token_but_keeps_has_token() {
        let mut srv = RemoteServer {
            id: "a".into(),
            name: "A".into(),
            url: "http://h:1".into(),
            token: Some(SensitiveString::new("secret".into())),
            ..RemoteServer::default()
        };
        srv.scrub_secrets();

        let json = serde_json::to_string(&srv).unwrap();
        assert!(!json.contains("secret"), "token leaked into {json}");
        assert!(!json.contains(r#""token""#), "the key itself must be omitted: {json}");
        assert!(json.contains(r#""has_token":true"#), "scrubbing must not erase has_token: {json}");
        assert!(srv.token.is_none());
    }

    #[test]
    fn scrub_secrets_reports_a_server_without_a_token_as_having_none() {
        let mut srv = RemoteServer {
            has_token: true, // a stale client-supplied value
            ..RemoteServer::default()
        };
        srv.scrub_secrets();
        let json = serde_json::to_string(&srv).unwrap();
        assert!(json.contains(r#""has_token":false"#), "{json}");
    }

    #[test]
    fn has_token_ignores_an_empty_token() {
        let mut srv = RemoteServer {
            token: Some(SensitiveString::new(String::new())),
            has_token: true, // stale client-supplied value
            ..RemoteServer::default()
        };
        srv.refresh_has_token();
        assert!(!srv.has_token);
    }
}
