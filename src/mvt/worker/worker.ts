import Pbf from 'pbf'
import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile'
import type {
  DecodedFeatureRecord,
  DecodedLayerRecord,
  DecodedTileRecord,
  TileDecodeJob,
  TileGeometryType,
} from '../types'

type WorkerRequest = {
  id: number
  kind: 'decode'
  job: TileDecodeJob
}

type WorkerSuccessResponse = {
  id: number
  ok: true
  tile: DecodedTileRecord
}

type WorkerErrorResponse = {
  id: number
  ok: false
  error: string
}

type WorkerScope = typeof globalThis & {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerSuccessResponse | WorkerErrorResponse) => void
}

const workerScope = globalThis as WorkerScope

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  if (message.kind !== 'decode') return

  try {
    const tile = await decodeTile(message.job)
    const response: WorkerSuccessResponse = {
      id: message.id,
      ok: true,
      tile,
    }
    workerScope.postMessage(response)
  } catch (error) {
    const response: WorkerErrorResponse = {
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    workerScope.postMessage(response)
  }
}

async function decodeTile(job: TileDecodeJob): Promise<DecodedTileRecord> {
  const fetchedAt = Date.now()
  const response = await fetch(job.url)

  if (!response.ok) {
    throw new Error(`Failed to fetch tile ${job.id}: ${response.status} ${response.statusText}`)
  }

  const buffer = await response.arrayBuffer()
  const vectorTile = new VectorTile(new Pbf(buffer))
  const layers = Object.entries(vectorTile.layers).map(([name, layer]) =>
    decodeLayer(name, layer),
  )

  return {
    id: job.id,
    sourceId: job.sourceId,
    coord: job.coord,
    url: job.url,
    fetchedBytes: buffer.byteLength,
    requestedAt: job.requestedAt,
    fetchedAt,
    decodedAt: Date.now(),
    layers,
  }
}

function decodeLayer(name: string, layer: VectorTile['layers'][string]): DecodedLayerRecord {
  const features: DecodedFeatureRecord[] = []
  const geometryHistogram: Record<TileGeometryType, number> = {
    Unknown: 0,
    Point: 0,
    LineString: 0,
    Polygon: 0,
  }

  for (let index = 0; index < layer.length; index += 1) {
    const feature = layer.feature(index)
    const type = VectorTileFeature.types[feature.type] ?? 'Unknown'
    const geometry = feature.loadGeometry().map((part) =>
      part.map((point) => [point.x, point.y] as [number, number]),
    )

    geometryHistogram[type] += 1

    features.push({
      id: feature.id,
      type,
      bbox: feature.bbox() as [number, number, number, number],
      properties: feature.properties,
      geometry,
    })
  }

  return {
    name,
    extent: layer.extent,
    featureCount: layer.length,
    geometryHistogram,
    features,
  }
}
