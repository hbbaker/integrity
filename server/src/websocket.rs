//! Minimal RFC 6455 WebSocket support: the handshake key, SHA-1, base64 and the
//! frame codec. Standard library only. Only what a browser client needs:
//! unfragmented frames, masked client frames, unmasked server frames.

use std::io::{self, Read};

pub const OP_TEXT: u8 = 0x1;
pub const OP_CLOSE: u8 = 0x8;
pub const OP_PING: u8 = 0x9;
pub const OP_PONG: u8 = 0xA;

/// Largest message a client may send. Game messages are far smaller.
pub const MAX_PAYLOAD: usize = 64 * 1024;

const HANDSHAKE_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub struct Frame {
    pub opcode: u8,
    pub payload: Vec<u8>,
}

/// The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`.
pub fn accept_key(client_key: &str) -> String {
    let mut input = client_key.trim().to_owned();
    input.push_str(HANDSHAKE_GUID);
    base64_encode(&sha1(input.as_bytes()))
}

/// Read one frame. Fragmented messages and extensions are rejected as invalid data.
pub fn read_frame<R: Read>(reader: &mut R) -> io::Result<Frame> {
    let mut head = [0u8; 2];
    reader.read_exact(&mut head)?;
    let fin = head[0] & 0x80 != 0;
    let reserved = head[0] & 0x70 != 0;
    let opcode = head[0] & 0x0F;
    let masked = head[1] & 0x80 != 0;
    if !fin || reserved {
        return Err(invalid("fragmented or extended frames are not supported"));
    }
    if !masked {
        return Err(invalid("client frames must be masked"));
    }

    let length = match head[1] & 0x7F {
        126 => {
            let mut bytes = [0u8; 2];
            reader.read_exact(&mut bytes)?;
            u16::from_be_bytes(bytes) as usize
        }
        127 => {
            let mut bytes = [0u8; 8];
            reader.read_exact(&mut bytes)?;
            usize::try_from(u64::from_be_bytes(bytes)).map_err(|_| invalid("frame too large"))?
        }
        short => short as usize,
    };
    if length > MAX_PAYLOAD {
        return Err(invalid("frame too large"));
    }

    let mut mask = [0u8; 4];
    reader.read_exact(&mut mask)?;
    let mut payload = vec![0u8; length];
    reader.read_exact(&mut payload)?;
    for (index, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[index % 4];
    }
    Ok(Frame { opcode, payload })
}

/// Build one unmasked server frame.
pub fn encode_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(payload.len() + 10);
    frame.push(0x80 | opcode);
    match payload.len() {
        0..=125 => frame.push(payload.len() as u8),
        126..=65535 => {
            frame.push(126);
            frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
        }
        _ => {
            frame.push(127);
            frame.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        }
    }
    frame.extend_from_slice(payload);
    frame
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut state: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];

    let mut message = data.to_vec();
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&((data.len() as u64) * 8).to_be_bytes());

    for chunk in message.chunks(64) {
        let mut words = [0u32; 80];
        for (index, word) in words.iter_mut().take(16).enumerate() {
            let at = index * 4;
            *word = u32::from_be_bytes([chunk[at], chunk[at + 1], chunk[at + 2], chunk[at + 3]]);
        }
        for index in 16..80 {
            words[index] =
                (words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16])
                    .rotate_left(1);
        }

        let [mut a, mut b, mut c, mut d, mut e] = state;
        for (index, word) in words.iter().enumerate() {
            let (mix, constant) = match index {
                0..=19 => ((b & c) | (!b & d), 0x5A827999),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let next = a
                .rotate_left(5)
                .wrapping_add(mix)
                .wrapping_add(e)
                .wrapping_add(constant)
                .wrapping_add(*word);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = next;
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut digest = [0u8; 20];
    for (index, word) in state.iter().enumerate() {
        digest[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for shift in [18, 12, 6, 0] {
            out.push(BASE64_ALPHABET[((triple >> shift) & 0x3F) as usize] as char);
        }
    }
    let padding = (3 - bytes.len() % 3) % 3;
    out.truncate(out.len() - padding);
    out.push_str(&"=".repeat(padding));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn should_hash_abc_when_given_the_sha1_reference_input() {
        assert_eq!(
            hex(&sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
    }

    #[test]
    fn should_hash_multi_block_input_when_longer_than_one_chunk() {
        let input = b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
        assert_eq!(
            hex(&sha1(input)),
            "84983e441c3bd26ebaae4aa1f95129e5e54670f1"
        );
    }

    #[test]
    fn should_encode_base64_with_padding_when_length_is_not_a_multiple_of_three() {
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"Man"), "TWFu");
    }

    #[test]
    fn should_match_the_rfc_6455_example_when_computing_the_accept_key() {
        assert_eq!(
            accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn should_unmask_payload_when_reading_a_client_frame() {
        let mask = [1u8, 2, 3, 4];
        let text = b"hello";
        let mut wire = vec![0x81, 0x80 | text.len() as u8];
        wire.extend_from_slice(&mask);
        wire.extend(text.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        let frame = read_frame(&mut wire.as_slice()).unwrap();
        assert_eq!(frame.opcode, OP_TEXT);
        assert_eq!(frame.payload, text);
    }

    #[test]
    fn should_use_the_extended_length_when_payload_exceeds_125_bytes() {
        let frame = encode_frame(OP_TEXT, &vec![b'x'; 300]);
        assert_eq!(&frame[..4], &[0x81, 126, 0x01, 0x2C]);
        assert_eq!(frame.len(), 4 + 300);
    }

    #[test]
    fn should_reject_unmasked_client_frames() {
        let wire = [0x81u8, 0x01, b'x'];
        assert!(read_frame(&mut wire.as_slice()).is_err());
    }

    #[test]
    fn should_reject_oversized_frames() {
        let mut wire = vec![0x81, 0x80 | 127];
        wire.extend_from_slice(&(MAX_PAYLOAD as u64 + 1).to_be_bytes());
        wire.extend_from_slice(&[0, 0, 0, 0]);
        assert!(read_frame(&mut wire.as_slice()).is_err());
    }
}
