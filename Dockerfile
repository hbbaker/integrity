# syntax=docker/dockerfile:1

FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY core/server core/server
COPY game/server game/server
RUN cargo build --release -p oneshot-server

FROM debian:bookworm-slim
RUN useradd --system --no-create-home oneshot
WORKDIR /app
COPY --from=build /src/target/release/oneshot-server /app/oneshot-server
COPY index.html ./
COPY core/client core/client
COPY game game
RUN rm -rf game/server

# GAME_DIR is required: the default static root is a compile-time path that does not exist here.
ENV GAME_DIR=/app PORT=8123
EXPOSE 8123
USER oneshot
CMD ["/app/oneshot-server"]
