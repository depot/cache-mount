# cache-mount

Mount a durable (POSIX compatible), low-latency cache directory that supports multi-write and shares content between runs

> [!IMPORTANT]
> This action only works in [Depot CI](https://depot.dev/docs/ci/overview) jobs. It will not work on Depot-managed GitHub Actions runners or GitHub-hosted runners.

> The cache mount is not scoped to repository. You may share content across builds within your Depot org.

> Public fork PRs skip mounting and only create the target directory.

## Usage

```yaml
jobs:
  mount-cache-disk:
    runs-on: depot-ubuntu-latest
    steps:
      - uses: depot/cache-mount@v1
        with:
          path: /tmp/cache-mount
          name: my-disk

      - name: list files
        run: |
          ls -la /tmp/cache-mount
```

## Inputs

| Input   | Required | Default | Description                                                                                             |
| ------- | -------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `path`  | **Yes**  | -       | OS location to mount the cache disk.                                                                    |
| `name`  | **Yes**  | -       | Name of the disk. Reuse the same name across runs to reference it. Created automatically on first use. |
| `debug` | No       | `false` | Enable verbose logging.                                                                                 |

## Use cases

Disk cache mostly shines as a **shared, mostly-read artifact store** that tools read by an explicit path.

The recurring pattern is **one writer, many readers**: a scheduled or post-merge job populates content, then all fan-out CI jobs mount it and read concurrently.

Possible fits:
- **Read-only reference data** - model weights, test fixtures, seed databases, toolchains/SDKs. Build once under a lock, read concurrently everywhere.
- **Content-addressed tool caches** pointed at the mount via env/flag - `GOCACHE`/`GOMODCACHE`, `CARGO_HOME` registry, `~/.m2`, `~/.gradle`, `ccache`/`sccache`, Bazel/buildkit local cache.
- **Directory-partitioned writes** - matrix or monorepo jobs that each write only their own slice (`/tmp/cache-mount/<arch>`, `/tmp/cache-mount/<pkg>`) to avoid contention.
- Something you would donwload from S3 for each jobs

## Lifecycle

Cache disks are exclusively created by this action upon use. To list all your active cache disks, navigate to the Depot CI settings page.

Cache disks are automatically deleted based on your organization's cache retention policy, configured on the organization settings page. The default retention is 14 days.

You may manually delete disks on the Depot CI settings page.

## FAQ

> Is there a limit on how many disk can a single job mount?
- There is no such limit

> Can I mount the same disk under different mount points?
- Absolutely

> Is there an enforced disk size limit?
- The disks scale infinitely

> How should I name my disks?
- It is up to you, just don't use whitespaces. Also, disk names are unique within your organization.

## License

MIT License - see [LICENSE](LICENSE) for details.
