# GeoNames place catalog

Tian Min uses an offline, server-side GeoNames catalog for new birth-place searches. Normal autocomplete does not call the GeoNames API and does not send place queries to an external geocoder.

## Snapshot

- version: `2026-08-13`;
- source: `https://download.geonames.org/export/dump/`;
- inputs: `cities500.zip`, `alternateNamesV2.zip`, `admin1CodesASCII.txt`;
- exact byte sizes and SHA-256 checksums: `web/data/geonames/manifest.json`;
- license: GeoNames geographical database, CC BY 4.0; attribution is retained in the repository `NOTICE`.

Raw dumps are not committed. `web/scripts/import-geonames.cjs` streams the official UTF-8 tab-separated files, keeps only populated places from `cities500`, filters alternate names to those place IDs, excludes link/postal/airport identifier rows, and produces gzip shards plus a provenance manifest.

```text
node scripts/import-geonames.cjs \
  --cities /path/cities500.zip \
  --alternates /path/alternateNamesV2.zip \
  --admin1 /path/admin1CodesASCII.txt \
  --out data/geonames \
  --version YYYY-MM-DD
```

The generated directory must be replaced atomically as one snapshot. Validate its checksums, import tests, mass multilingual regression, fixed regression, full web tests and build before commit/deploy.

## Runtime design

The browser receives at most eight results. The application loads only the gzip name shard needed for a query and the small place shards needed for returned IDs. Bounded LRU caches avoid loading the complete world catalog into application RAM. Exact and prefix ranking precede bounded edit-distance fallback; generic capital/admin/population prominence is precomputed into the name index, and only a bounded candidate set reaches place-shard loading.

New identity is `geonames:<geonameId>`. Russian UI uses a non-historic Russian alternate name when GeoNames provides one. A matched historical alias retains `isHistoric`, `from`, and `to`, while display continues to identify the current canonical place. Previously persisted `city-timezones` IDs are resolved by a read-only compatibility adapter; new searches never create them.

## Time and solar invariant

GeoNames provides WGS84 city-center latitude/longitude and an IANA time-zone ID. The IANA identifier is validated and passed to the existing historical tzdata engine. No current UTC offset is persisted. Longitude continues through the unchanged `TRUE_SOLAR_TIME_V1` implementation. A timezone override never replaces coordinates.

## Refresh strategy

Use deliberate versioned snapshots rather than downloading data during every Railway deploy. A periodic refresh repeats the full import and validation. GeoNames also publishes daily `modifications-YYYY-MM-DD.txt`, `deletes-YYYY-MM-DD.txt`, `alternateNamesModifications-YYYY-MM-DD.txt`, and `alternateNamesDeletes-YYYY-MM-DD.txt`; incremental application is a future optimization, not part of the initial snapshot contract.

`cities500` is the primary tier. A broader `allCountries` feature-class-P fallback is not activated: it would substantially increase raw/import/index size and is not justified until measured missing-place evidence shows that the 235k-place primary catalog is insufficient.

## Storage decision

The snapshot uses application-owned read-only shards instead of PostgreSQL for v1. This avoids a non-atomic production DB import, deploy-time downloads and a database extension dependency, while remaining rollbackable with the application commit. PostgreSQL remains suitable for a future independently managed gazetteer service, but it would store the same 235k places and 1.3m names plus indexes; no operational benefit justified that migration for the initial release.

## Measured profile (2026-08-13)

- raw official inputs: 216,413,103 compressed bytes; 819,444,621 extracted bytes;
- generated snapshot: 36,484,685 file bytes (38,908 KiB allocated by `du`), 1,537 files;
- import: 66.259 s on the development machine;
- catalog: 235,285 places, 1,338,166 relevant alternate names, 1,579,175 indexed names;
- Russian display-name coverage: 43,424 places / 18.46%; an automatically selected set of 1,000 unambiguous Russian/canonical pairs passes with the same GeoNames ID, coordinates and timezone;
- lazy provider startup RSS: 57.7 MB total in an isolated Node process; `city-timezones` alone added 9.1 MB RSS in the same measurement style;
- 1,200 searches across Russian, English, native-script, historical, short-prefix and no-result queries: p50 4.47 ms, p95 28.32 ms, max 47.87 ms; after forced GC, heap used was 25.0 MB and RSS retained by V8 was 234.1 MB after deliberately cache-thrashing the provider;
- runtime external GeoNames requests: zero.

No local PostgreSQL server was available, so a PostgreSQL physical-size claim was not fabricated and production PostgreSQL was not mutated for a benchmark. A row-count/storage projection for 235k place rows plus 1.58m normalized-name rows and their B-tree/trigram indexes is several hundred MB, versus the measured 36.5 MB read-only snapshot. The static option was selected on measured artifact/runtime behavior and simpler atomic rollback; PostgreSQL should be measured on an isolated clone before any future switch.
