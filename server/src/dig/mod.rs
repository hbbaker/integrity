//! DIG SITE: a multiplayer utility-locating game. Players dig a shared site for
//! points while hidden underground utilities punish careless digging.
//!
//! The server owns everything hidden:
//!   layout  builds the site and its buried lines from a seed (pure function)
//!   rules   depths, scoring and dig resolution (pure, takes the time as input)
//!   lobby   the lobby and match state machine (pure, returns the messages to send)
//! The hub only moves messages between sockets and this module.

pub mod layout;
pub mod lobby;
pub mod rules;
