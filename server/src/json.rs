//! A small JSON value type with a parser and a writer. Standard library only.
//!
//! The game server reads client messages and builds replies with this, so every
//! message is checked properly instead of being picked apart as text.

use std::fmt::Write;

/// Deepest nesting the parser accepts: protects the stack from hostile input.
const MAX_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    /// Keys keep their insertion order, so output is stable.
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn parse(text: &str) -> Option<Json> {
        let mut parser = Parser {
            bytes: text.as_bytes(),
            at: 0,
        };
        let value = parser.value(0)?;
        parser.skip_space();
        (parser.at == parser.bytes.len()).then_some(value)
    }

    /// Build an object from `(key, value)` pairs.
    pub fn obj<const N: usize>(pairs: [(&str, Json); N]) -> Json {
        Json::Obj(
            pairs
                .into_iter()
                .map(|(key, value)| (key.to_owned(), value))
                .collect(),
        )
    }

    pub fn str(text: &str) -> Json {
        Json::Str(text.to_owned())
    }

    pub fn num(value: impl Into<f64>) -> Json {
        Json::Num(value.into())
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Obj(pairs) => pairs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(text) => Some(text),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(value) if value.is_finite() => Some(*value),
            _ => None,
        }
    }

    /// A whole number, or None for fractions and out-of-range values.
    pub fn as_i32(&self) -> Option<i32> {
        let value = self.as_f64()?;
        (value.fract() == 0.0 && value >= f64::from(i32::MIN) && value <= f64::from(i32::MAX))
            .then_some(value as i32)
    }

    #[cfg(test)]
    pub fn as_arr(&self) -> Option<&[Json]> {
        match self {
            Json::Arr(items) => Some(items),
            _ => None,
        }
    }

    pub fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
            Json::Num(value) => write_number(*value, out),
            Json::Str(text) => write_string(text, out),
            Json::Arr(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Obj(pairs) => {
                out.push('{');
                for (index, (key, value)) in pairs.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    write_string(key, out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

impl std::fmt::Display for Json {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut text = String::new();
        self.write(&mut text);
        formatter.write_str(&text)
    }
}

fn write_number(value: f64, out: &mut String) {
    if !value.is_finite() {
        out.push_str("null"); // JSON has no NaN or infinity
    } else if value.fract() == 0.0 && value.abs() < 1e15 {
        let _ = write!(out, "{}", value as i64);
    } else {
        let _ = write!(out, "{value}");
    }
}

fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            control if (control as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", control as u32);
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

struct Parser<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl Parser<'_> {
    fn skip_space(&mut self) {
        while self.at < self.bytes.len()
            && matches!(self.bytes[self.at], b' ' | b'\t' | b'\n' | b'\r')
        {
            self.at += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn eat(&mut self, expected: u8) -> Option<()> {
        (self.peek()? == expected).then(|| self.at += 1)
    }

    fn literal(&mut self, word: &str, value: Json) -> Option<Json> {
        let end = self.at + word.len();
        (self.bytes.get(self.at..end)? == word.as_bytes()).then(|| {
            self.at = end;
            value
        })
    }

    fn value(&mut self, depth: usize) -> Option<Json> {
        if depth > MAX_DEPTH {
            return None;
        }
        self.skip_space();
        match self.peek()? {
            b'n' => self.literal("null", Json::Null),
            b't' => self.literal("true", Json::Bool(true)),
            b'f' => self.literal("false", Json::Bool(false)),
            b'"' => self.string().map(Json::Str),
            b'[' => self.array(depth),
            b'{' => self.object(depth),
            b'-' | b'0'..=b'9' => self.number(),
            _ => None,
        }
    }

    fn number(&mut self) -> Option<Json> {
        let start = self.at;
        while self
            .peek()
            .is_some_and(|byte| matches!(byte, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
        {
            self.at += 1;
        }
        let text = std::str::from_utf8(&self.bytes[start..self.at]).ok()?;
        text.parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .map(Json::Num)
    }

    fn string(&mut self) -> Option<String> {
        self.eat(b'"')?;
        let mut out = String::new();
        loop {
            let byte = self.peek()?;
            self.at += 1;
            match byte {
                b'"' => return Some(out),
                b'\\' => out.push(self.escape()?),
                0..=0x1F => return None, // raw control characters are not allowed
                _ => {
                    // Copy the whole UTF-8 sequence this byte starts.
                    let start = self.at - 1;
                    let length = match byte {
                        0..=0x7F => 1,
                        0xC0..=0xDF => 2,
                        0xE0..=0xEF => 3,
                        _ => 4,
                    };
                    let chunk = self.bytes.get(start..start + length)?;
                    out.push_str(std::str::from_utf8(chunk).ok()?);
                    self.at = start + length;
                }
            }
        }
    }

    fn escape(&mut self) -> Option<char> {
        let byte = self.peek()?;
        self.at += 1;
        Some(match byte {
            b'"' => '"',
            b'\\' => '\\',
            b'/' => '/',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'b' => '\u{8}',
            b'f' => '\u{c}',
            b'u' => {
                let digits = std::str::from_utf8(self.bytes.get(self.at..self.at + 4)?).ok()?;
                self.at += 4;
                char::from_u32(u32::from_str_radix(digits, 16).ok()?)? // lone surrogates are refused
            }
            _ => return None,
        })
    }

    fn array(&mut self, depth: usize) -> Option<Json> {
        self.eat(b'[')?;
        let mut items = Vec::new();
        self.skip_space();
        if self.peek()? == b']' {
            self.at += 1;
            return Some(Json::Arr(items));
        }
        loop {
            items.push(self.value(depth + 1)?);
            self.skip_space();
            match self.peek()? {
                b',' => self.at += 1,
                b']' => {
                    self.at += 1;
                    return Some(Json::Arr(items));
                }
                _ => return None,
            }
        }
    }

    fn object(&mut self, depth: usize) -> Option<Json> {
        self.eat(b'{')?;
        let mut pairs = Vec::new();
        self.skip_space();
        if self.peek()? == b'}' {
            self.at += 1;
            return Some(Json::Obj(pairs));
        }
        loop {
            self.skip_space();
            let key = self.string()?;
            self.skip_space();
            self.eat(b':')?;
            pairs.push((key, self.value(depth + 1)?));
            self.skip_space();
            match self.peek()? {
                b',' => self.at += 1,
                b'}' => {
                    self.at += 1;
                    return Some(Json::Obj(pairs));
                }
                _ => return None,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_parse_nested_values_when_given_valid_json() {
        let value =
            Json::parse(r#" {"t":"dg_dig","x":3,"z":-4,"tags":["a","b"],"ok":true,"none":null} "#)
                .unwrap();
        assert_eq!(value.get("t").and_then(Json::as_str), Some("dg_dig"));
        assert_eq!(value.get("x").and_then(Json::as_i32), Some(3));
        assert_eq!(value.get("z").and_then(Json::as_i32), Some(-4));
        assert_eq!(
            value.get("tags").and_then(Json::as_arr).map(<[Json]>::len),
            Some(2)
        );
        assert_eq!(value.get("ok"), Some(&Json::Bool(true)));
        assert_eq!(value.get("none"), Some(&Json::Null));
    }

    #[test]
    fn should_round_trip_when_written_and_parsed_again() {
        let original = Json::obj([
            ("name", Json::str("a \"quoted\" \\ name\nline")),
            ("n", Json::num(1.5)),
            (
                "list",
                Json::Arr(vec![Json::num(1), Json::Null, Json::Bool(false)]),
            ),
        ]);
        assert_eq!(Json::parse(&original.to_string()), Some(original));
    }

    #[test]
    fn should_reject_malformed_json() {
        for bad in [
            "",
            "{",
            "{\"a\":}",
            "[1,]",
            "{\"a\":1,}",
            "{a:1}",
            "\"unterminated",
            "{\"a\":1} extra",
            "nul",
            "01x",
        ] {
            assert!(Json::parse(bad).is_none(), "{bad:?} should not parse");
        }
    }

    #[test]
    fn should_reject_deeply_nested_input_when_over_the_depth_limit() {
        let deep = format!("{}{}", "[".repeat(100), "]".repeat(100));
        assert!(Json::parse(&deep).is_none());
        let fine = format!("{}{}", "[".repeat(10), "]".repeat(10));
        assert!(Json::parse(&fine).is_some());
    }

    #[test]
    fn should_decode_unicode_escapes_and_multibyte_text() {
        assert_eq!(Json::parse(r#""é""#), Some(Json::str("é")));
        assert_eq!(Json::parse("\"naïve ▸ ok\""), Some(Json::str("naïve ▸ ok")));
        assert!(Json::parse(r#""\ud800""#).is_none()); // lone surrogate
    }

    #[test]
    fn should_return_none_for_fractions_when_a_whole_number_is_required() {
        assert_eq!(Json::parse("2.5").unwrap().as_i32(), None);
        assert_eq!(Json::parse("1e20").unwrap().as_i32(), None);
        assert_eq!(Json::parse("-7").unwrap().as_i32(), Some(-7));
    }

    #[test]
    fn should_write_integers_without_a_decimal_point() {
        assert_eq!(Json::num(42).to_string(), "42");
        assert_eq!(Json::num(0.25).to_string(), "0.25");
        assert_eq!(Json::Num(f64::NAN).to_string(), "null");
    }
}
