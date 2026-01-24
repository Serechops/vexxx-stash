# Introduction

This dockerfile is used to build a stash docker container using the current source code. This is ideal for testing your current branch in docker. Note that it does not include python, so python-based scrapers will not work in this image. The production docker images distributed by the project contain python and the necessary packages.

# Building the docker container

From the top-level directory (should contain `tools.go` file):

```
make docker-build

```

# Running the docker container

## Using docker-compose

See the `README.md` file in `docker/production` for instructions on how to get docker-compose if needed.

The `stash/build` container can be run with the `docker-compose.yml` file in `docker/production` by changing the `image` value to be `stash/build`. See the instructions in `docker/production` for how to run docker-compose.

## Using `docker run`

After building the container:

```
docker run \
 -e STASH_STASH=/data/ \
 -e STASH_METADATA=/metadata/ \
 -e STASH_CACHE=/cache/ \
 -e STASH_GENERATED=/generated/ \
 -v <path to config dir>:/root/.stash \
 -v <path to media>:/data \
 -v <path to metadata>:/metadata \
 -v <path to cache>:/cache \
 -v <path to generated>:/generated \
 -p 9999:9999 \
 stash/build:latest 
```

## Easy Setup Scripts (Recommended)

We provide standalone scripts that walk you through mounting your media libraries:

### Windows

```batch
cd docker\build\x86_64
setup-stash.bat
```

### Linux / macOS

```bash
cd docker/build/x86_64
chmod +x setup-stash.sh
./setup-stash.sh
```

The scripts will:
1. Prompt for your config directory (where Stash stores its database)
2. Prompt for generated files directory (thumbnails, transcodes)
3. Let you add multiple media library paths
4. Generate a `docker-compose.generated.yml` and/or a `docker run` command

After running the script, start Stash with:

```bash
docker compose -f docker-compose.generated.yml up -d
```

### Path Mapping

Your host paths are mapped to container paths like this:

| Host Path | Container Path |
|-----------|----------------|
| Config dir | `/root/.stash` |
| Generated dir | `/generated` |
| Media library 1 | `/data/library1` |
| Media library 2 | `/data/library2` |
| ... | ... |

**Important**: When adding libraries in Stash's UI, use the *container* paths (e.g., `/data/library1`).

### Adding More Libraries Later

To add new media libraries to an existing setup:

1. Stop the container: `docker stop stash`
2. Remove it: `docker rm stash`
3. Re-run the setup script with all paths (existing + new)
4. Start again: `docker compose -f docker-compose.generated.yml up -d`

Your Stash data (database, config) is preserved because it lives on the host in your config directory.

---

## Docker Compose (manual / build from source)

You can also use the provided `docker-compose.yml` to build the image from source:

```bash
# copy example env
cp .env.example .env

# build and run in detached mode
docker compose up --build -d
```

Configuration notes:
- Edit `.env` to set `HOST_CONFIG`, `HOST_MEDIA_PATH`, and `HOST_STORAGE` to host directories you want mounted into the container.
- On Windows use absolute paths in `.env` (e.g. `C:\Users\you\Media`). If using Docker Desktop make sure the drive is shared.

If you run into permission issues on Linux, set `PUID` and `PGID` in `.env` to match your host user so files created by the container are accessible.


Change the `<xxx>` to the appropriate paths. Note that the `<path to media>` directory should be separate from the cache, generated and metadata directories. It is recommended to have the cache, generated and metadata directories in the same parent directory, for example:

```
/stash
  /config
  /metadata
  /generated
  /cache
/media
```

Using this example directory structure, the above command would be:

```
docker run \
 -e STASH_STASH=/data/ \
 -e STASH_METADATA=/metadata/ \
 -e STASH_CACHE=/cache/ \
 -e STASH_GENERATED=/generated/ \
 -v /stash/config:/root/.stash \
 -v /media:/data \
 -v /stash/metadata:/metadata \
 -v /stash/cache:/cache \
 -v /stash/generated:/generated \
 -p 9999:9999 \
 stash/build:latest 
```
