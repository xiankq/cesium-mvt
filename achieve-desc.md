参考maplibre原代码，创建一个基于cesium primitive、draw command的高性能mvt渲染库

## 借鉴maplibre的依赖库列表，看看有没有能复用的库

```
@mapbox/jsonlint-lines-primitives ^2.0.2
@mapbox/point-geometry ^1.1.0
@mapbox/tiny-sdf ^2.0.7
@mapbox/unitbezier ^0.0.1
@mapbox/vector-tile ^2.0.4
@mapbox/whoots-js ^3.1.0
@maplibre/geojson-vt ^6.0.4
@maplibre/maplibre-gl-style-spec ^24.8.1
@maplibre/mlt ^1.1.8
@maplibre/vt-pbf ^4.3.0
@types/geojson ^7946.0.16
earcut ^3.0.2
gl-matrix ^3.4.4
kdbush ^4.0.2
murmurhash-js ^1.0.0
pbf ^4.0.1
potpack ^2.1.0
quickselect ^3.0.0
tinyqueue ^3.0.0
```
