# cache-mount

Mount a durable cache directory which supports mult-write and shares content between runs

> The cache mount is not scoped to repository. You may share content across builds within your Depot org.

## Usage

```yaml
jobs:
  mount-cache-disk:
    runs-on: depot-ubuntu-latest
    steps:
      - uses: depot/cache-mount@v1
        with:
          path: /mnt/cache-mount
          name: my-disk
```

## Inputs

| Input      | Required | Default                 | Description                                                     |
| ---------- | -------- | ----------------------- | --------------------------------------------------------------- |
| `path`     | **Yes**  | `/mnt/cache-disk`       | OS location to mount the cache disk.                            |
| `name`     | **Yes**  | —                       | Name of the disk. Reuse the same name across runs to reference it. Created automatically on first use. |
| `debug`    | No       | `false`                 | Enable verbose logging                                          |

## License

MIT License - see [LICENSE](LICENSE) for details.