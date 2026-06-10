const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Sigvis API",
    version: "2.0.0",
    description: `
API used by the Sigvis frontend and external data producers.

---

## MQTT — Ingest via Message Broker

The server can subscribe to an MQTT broker and ingest data from incoming messages.

### Configuration

Set the following environment variables before starting the server (or update them at runtime via \`PUT /api/admin/config\`):

| Variable | Description |
|---|---|
| \`MQTT_BROKER_URL\` | Broker URL, e.g. \`mqtt://192.168.1.10:1883\`. Leave unset to disable MQTT. |
| \`MQTT_CLIENT_ID\` | Client identifier (auto-generated if blank). |
| \`MQTT_USERNAME\` | Optional broker username. |
| \`MQTT_PASSWORD\` | Optional broker password. |
| \`MQTT_INGEST_TOPIC\` | Topic to subscribe to (default: \`cmnd/sigvis/ingest\`). |

### Payload format

Publish a JSON payload to the configured ingest topic. The format is **identical** to the HTTP \`POST /api/series/ingest\` body — including the optional \`clearMeasurement\` flag:

\`\`\`json
{
  "measurementName": "cpu_like",
  "clearMeasurement": false,
  "points": {
    "timestamps": [1714480000000, 1714480001000],
    "series": {
      "value": [42.1, 43.5]
    }
  }
}
\`\`\`

Setting \`"clearMeasurement": true\` erases all existing data for the measurement before writing the new points, giving a completely fresh start. Omit the field (or set it to \`false\`) for normal append behaviour. See the \`MeasurementIngestRequest\` schema for the full field reference.

### Ordering guarantee

Messages published to the broker are processed **in the order they are received** by the server's MQTT client. There is no cross-message deduplication — if two messages overlap in their timestamp ranges the later one wins for the overlapping points.

---

## WebSocket — Live Data Subscriptions

Connect to \`ws://HOST/\` (same host and port as the HTTP server).

### Subscribe

Send a JSON message to register interest in one or more measurements.
Sending a new \`subscribe\` **replaces** the previous subscription for the connection, resets the server's "last sent" state, and triggers an immediate **snapshot**.

\`\`\`json
{
  "type": "subscribe",
  "measurements": [
    { "measurementName": "Demo1",     "series": ["value", "envelope"], "points": 500 },
    { "measurementName": "sine_fast", "series": ["value"],             "points": 120 }
  ]
}
\`\`\`

- \`series\` — array of data series names within that measurement to receive
- \`points\` — maximum number of historical points to receive in the initial snapshot; subsequent deltas are unbounded

### Server → Client messages

**Snapshot** (sent once per subscribe, immediately):

\`\`\`json
{
  "type": "snapshot",
  "measurements": [
    {
      "measurementName": "Demo1",
      "timestamps": [1714480000000, 1714480001000],
      "series": [
        { "name": "value",    "values": [0.12, -0.34] },
        { "name": "envelope", "values": [1.28,  1.27] }
      ]
    }
  ]
}
\`\`\`

**Delta** (sent whenever new points are available, throttled by \`MIN_PUSH_INTERVAL_MS\`):

\`\`\`json
{
  "type": "delta",
  "measurements": [
    {
      "measurementName": "Demo1",
      "timestamps": [1714480002000],
      "series": [
        { "name": "value",    "values": [0.55] },
        { "name": "envelope", "values": [1.30] }
      ]
    }
  ]
}
\`\`\`

Only points with timestamps **strictly after** the last timestamp already sent are included. If there are no new points, no message is sent.

**Error**:

\`\`\`json
{ "type": "error", "message": "Description of the problem." }
\`\`\`

### Push throttle

The server will not push to a connection more often than \`minPushIntervalMs\` per measurement (configurable via the \`/api/admin/config\` endpoint or the \`MIN_PUSH_INTERVAL_MS\` environment variable, default **30 ms**). A trailing push is always scheduled so no update is silently dropped.

### Reconnection

On reconnect, the client should re-send the same \`subscribe\` message. The server resets its state and sends a fresh snapshot, keeping the client fully up to date.
`.trim()
  },
  servers: [
    {
      url: "http://localhost:3000"
    }
  ],
  tags: [
    { name: "Health" },
    { name: "Series" },
    { name: "Admin Series" },
    { name: "Admin Config" },
    { name: "Admin Processors" },
    { name: "Dashboards" }
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Get service health status",
        responses: {
          200: {
            description: "Health check response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "timestamp"],
                  properties: {
                    status: { type: "string", example: "ok" },
                    timestamp: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/series/catalog": {
      get: {
        tags: ["Series"],
        summary: "List all known measurements and their data series",
        responses: {
          200: {
            description: "Measurement catalog",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: { $ref: "#/components/schemas/MeasurementCatalogItem" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/series/data": {
      get: {
        tags: ["Series"],
        summary: "Fetch historical data for one or more data series (REST, for history/export use)",
        parameters: [
          {
            name: "series",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Comma-separated compound identifiers in 'measurementName:dataName' format (example: Demo1:value,Demo1:envelope,sine_fast:value)."
          },
          {
            name: "points",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100000, default: 120 }
          },
          {
            name: "interval",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 3600, default: 30 },
            description: "Used only for synthetic fallback series generation (seconds between points)."
          }
        ],
        responses: {
          200: {
            description: "Grouped measurement data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MeasurementDataResponse" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" },
          404: { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/api/series/ingest": {
      post: {
        tags: ["Series"],
        summary: "Ingest data points for a measurement",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MeasurementIngestRequest" }
            }
          }
        },
        responses: {
          200: {
            description: "Ingest result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["measurementName", "ingestedCount", "totalPoints", "thresholdSeconds"],
                  properties: {
                    measurementName: { type: "string" },
                    ingestedCount: { type: "integer" },
                    totalPoints: { type: "integer" },
                    thresholdSeconds: { type: "integer" }
                  }
                }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/series": {
      get: {
        tags: ["Admin Series"],
        summary: "List admin state for all measurements",
        responses: {
          200: {
            description: "Measurement admin state",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["defaultThresholdSeconds", "demo", "items"],
                  properties: {
                    defaultThresholdSeconds: { type: "integer" },
                    demo: { $ref: "#/components/schemas/DemoStatus" },
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["measurementName", "thresholdSeconds", "pointCount", "dataSeriesNames"],
                        properties: {
                          measurementName: { type: "string" },
                          thresholdSeconds: { type: "integer" },
                          pointCount: { type: "integer" },
                          dataSeriesNames: { type: "array", items: { type: "string" } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/admin/series/{measurementName}": {
      put: {
        tags: ["Admin Series"],
        summary: "Set retention threshold for one measurement",
        parameters: [
          {
            name: "measurementName",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["thresholdSeconds"],
                properties: {
                  thresholdSeconds: { type: "number", minimum: 0 }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "Updated threshold",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["measurementName", "thresholdSeconds"],
                  properties: {
                    measurementName: { type: "string" },
                    thresholdSeconds: { type: "integer" }
                  }
                }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/series/{measurementName}/demo": {
      get: {
        tags: ["Admin Series"],
        summary: "Get demo producer status",
        parameters: [
          {
            name: "measurementName",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "Demo status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DemoStatus" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      },
      put: {
        tags: ["Admin Series"],
        summary: "Update demo producer parameters",
        parameters: [
          {
            name: "measurementName",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  demoBaseFrequency: { type: "number", minimum: 0 },
                  generationSpeedHz: { type: "number", exclusiveMinimum: 0 },
                  modulationRateHz: { type: "number", exclusiveMinimum: 0 },
                  modulationDepth: { type: "number", minimum: 0, maximum: 1.25 }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "Updated demo status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DemoStatus" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/series/{measurementName}/demo/start": {
      post: {
        tags: ["Admin Series"],
        summary: "Start demo producer",
        parameters: [
          {
            name: "measurementName",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "Demo status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DemoStatus" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/series/{measurementName}/demo/stop": {
      post: {
        tags: ["Admin Series"],
        summary: "Stop demo producer",
        parameters: [
          {
            name: "measurementName",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "Demo status",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DemoStatus" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/config": {
      get: {
        tags: ["Admin Config"],
        summary: "Get runtime server configuration",
        responses: {
          200: {
            description: "Current server config",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ServerConfig" }
              }
            }
          }
        }
      },
      put: {
        tags: ["Admin Config"],
        summary: "Update runtime server configuration",
        description: "Changes take effect immediately. Not persisted — a server restart resets values to environment-variable defaults.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServerConfig" }
            }
          }
        },
        responses: {
          200: {
            description: "Updated server config",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ServerConfig" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/generators": {
      get: {
        tags: ["Admin Generators"],
        summary: "List all generators",
        description: "Returns `{ paused, items }`. `paused` is true when the master pause is active. Scripts are omitted from summary records.",
        responses: {
          200: {
            description: "Generator list",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeneratorListResponse" }
              }
            }
          }
        }
      },
      post: {
        tags: ["Admin Generators"],
        summary: "Create a new generator",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GeneratorWrite" }
            }
          }
        },
        responses: {
          201: {
            description: "Created generator",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeneratorDetail" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/generators/pause": {
      post: {
        tags: ["Admin Generators"],
        summary: "Pause all generators",
        description: "Clears all active intervals without modifying individual `enabled` flags. Enabled generators can be restarted with `POST /api/admin/generators/resume`.",
        responses: {
          200: {
            description: "Paused",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { paused: { type: "boolean", example: true } }
                }
              }
            }
          }
        }
      }
    },
    "/api/admin/generators/resume": {
      post: {
        tags: ["Admin Generators"],
        summary: "Resume all generators",
        description: "Restarts intervals for every generator that has `enabled: true`.",
        responses: {
          200: {
            description: "Resumed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { paused: { type: "boolean", example: false } }
                }
              }
            }
          }
        }
      }
    },
    "/api/admin/generators/{id}": {
      get: {
        tags: ["Admin Generators"],
        summary: "Get a single generator including scripts / config",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "Generator detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeneratorDetail" }
              }
            }
          },
          404: { $ref: "#/components/responses/NotFound" }
        }
      },
      put: {
        tags: ["Admin Generators"],
        summary: "Update a generator",
        description: "All fields are optional. `clearState: true` resets the generator's in-memory state and re-runs its init function/script.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/GeneratorWrite" }
            }
          }
        },
        responses: {
          200: {
            description: "Updated generator",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GeneratorDetail" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" },
          404: { $ref: "#/components/responses/NotFound" }
        }
      },
      delete: {
        tags: ["Admin Generators"],
        summary: "Stop and delete a generator",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          204: { description: "Deleted" },
          404: { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/api/admin/prebuilts": {
      get: {
        tags: ["Admin Generators", "Admin Processors"],
        summary: "List all prebuilt catalog entries",
        description: "Returns metadata for all built-in prebuilt generators and processors. Used by the settings UI to populate the catalog dropdown and render config forms.",
        responses: {
          200: {
            description: "Prebuilt catalog",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["id", "displayName", "kind", "description"],
                    properties: {
                      id:          { type: "string", description: "Stable catalog identifier (e.g. 'sine-generator')." },
                      displayName: { type: "string" },
                      kind:        { type: "string", enum: ["generator", "processor"] },
                      description: { type: "string" },
                      paramSchema: {
                        type: "array",
                        description: "Parameter definitions used to render the config form.",
                        items: {
                          type: "object",
                          properties: {
                            name:     { type: "string" },
                            label:    { type: "string" },
                            type:     { type: "string", description: "One of: string, number, measurement, series." },
                            default:  { },
                            required: { type: "boolean" },
                            min:      { type: "number" },
                            max:      { type: "number" },
                            help:     { type: "string", description: "Help text shown in the UI." }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/admin/processors": {
      get: {
        tags: ["Admin Processors"],
        summary: "List all processors",
        description: "Returns summary records (scripts and config omitted). Use `GET /api/admin/processors/{id}` to retrieve the full record including code or config.",
        responses: {
          200: {
            description: "Processor list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/ProcessorSummary" }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Admin Processors"],
        summary: "Create a new processor",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProcessorWrite" }
            }
          }
        },
        responses: {
          201: {
            description: "Created processor",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProcessorDetail" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    },
    "/api/admin/processors/{id}": {
      get: {
        tags: ["Admin Processors"],
        summary: "Get a single processor including its code",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          200: {
            description: "Processor detail",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProcessorDetail" }
              }
            }
          },
          404: { $ref: "#/components/responses/NotFound" }
        }
      },
      put: {
        tags: ["Admin Processors"],
        summary: "Update a processor",
        description: "All fields are optional. Supplying `code` invalidates the cached compiled script; the new code is compiled on the next run.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProcessorWrite" }
            }
          }
        },
        responses: {
          200: {
            description: "Updated processor",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ProcessorDetail" }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" },
          404: { $ref: "#/components/responses/NotFound" }
        }
      },
      delete: {
        tags: ["Admin Processors"],
        summary: "Delete a processor",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: {
          204: { description: "Deleted" },
          404: { $ref: "#/components/responses/NotFound" }
        }
      }
    },
    "/api/dashboards": {
      get: {
        tags: ["Dashboards"],
        summary: "List saved dashboards",
        responses: {
          200: {
            description: "Saved dashboards",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["name"],
                        properties: {
                          name: { type: "string" },
                          savedAt: { type: "string", format: "date-time", nullable: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/api/dashboards/{name}": {
      get: {
        tags: ["Dashboards"],
        summary: "Load one dashboard",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "Dashboard payload",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "dashboard"],
                  properties: {
                    name: { type: "string" },
                    savedAt: { type: "string", format: "date-time", nullable: true },
                    dashboard: { $ref: "#/components/schemas/DashboardPayload" }
                  }
                }
              }
            }
          },
          404: { $ref: "#/components/responses/NotFound" }
        }
      },
      put: {
        tags: ["Dashboards"],
        summary: "Save one dashboard",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["dashboard"],
                properties: {
                  dashboard: { $ref: "#/components/schemas/DashboardPayload" }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: "Saved dashboard",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "savedAt", "dashboard"],
                  properties: {
                    name: { type: "string" },
                    savedAt: { type: "string", format: "date-time" },
                    dashboard: { $ref: "#/components/schemas/DashboardPayload" }
                  }
                }
              }
            }
          },
          400: { $ref: "#/components/responses/BadRequest" }
        }
      }
    }
  },
  components: {
    responses: {
      BadRequest: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
      },
      NotFound: {
        description: "Resource not found",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" }
          }
        }
      }
    },
    schemas: {
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" }
        }
      },
      DataSeriesEntry: {
        type: "object",
        required: ["name", "unit", "color", "values"],
        properties: {
          name: { type: "string" },
          unit: { type: "string" },
          color: { type: "string" },
          values: {
            type: "array",
            items: { type: ["number", "null"] }
          }
        }
      },
      MeasurementDataGroup: {
        type: "object",
        required: ["measurementName", "timestamps", "series"],
        properties: {
          measurementName: { type: "string" },
          timestamps: {
            type: "array",
            items: { type: "integer" }
          },
          series: {
            type: "array",
            items: { $ref: "#/components/schemas/DataSeriesEntry" }
          }
        }
      },
      MeasurementCatalogItem: {
        type: "object",
        required: ["measurementName", "series"],
        properties: {
          measurementName: { type: "string" },
          series: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "unit", "color"],
              properties: {
                name: { type: "string" },
                unit: { type: "string" },
                color: { type: "string" }
              }
            }
          }
        }
      },
      MeasurementDataResponse: {
        type: "object",
        required: ["measurements"],
        properties: {
          measurements: {
            type: "array",
            items: { $ref: "#/components/schemas/MeasurementDataGroup" }
          }
        }
      },
      MeasurementIngestRequest: {
        type: "object",
        required: ["measurementName", "points"],
        properties: {
          measurementName: { type: "string" },
          clearMeasurement: {
            type: "boolean",
            default: false,
            description: "When true, all existing data (timestamps and series) for the measurement is erased before the new points are written, giving a completely fresh start. Omit or set to false for normal append/merge behaviour."
          },
          points: {
            type: "object",
            required: ["timestamps", "series"],
            properties: {
              timestamps: {
                type: "array",
                items: { type: "number" },
                description: "Strictly increasing millisecond timestamps."
              },
              series: {
                type: "object",
                minProperties: 1,
                description: "Map of series name to value array. Each array must be the same length as timestamps.",
                additionalProperties: {
                  type: "array",
                  items: { type: "number" }
                },
                example: { "value": [42.1, 43.5], "smoothed": [41.9, 43.1] }
              }
            }
          }
        }
      },
      DemoStatus: {
        type: "object",
        required: [
          "seriesName",
          "running",
          "demoBaseFrequency",
          "generationSpeedHz",
          "modulationRateHz",
          "modulationDepth"
        ],
        properties: {
          seriesName: { type: "string" },
          running: { type: "boolean" },
          demoBaseFrequency: { type: "number" },
          generationSpeedHz: { type: "number" },
          modulationRateHz: { type: "number" },
          modulationDepth: { type: "number" }
        }
      },
      ServerConfig: {
        type: "object",
        required: ["minPushIntervalMs"],
        properties: {
          minPushIntervalMs: {
            type: "integer",
            minimum: 1,
            description: "Minimum interval between WebSocket push messages per measurement (milliseconds)."
          },
          mqtt: {
            type: "object",
            description: "MQTT ingestion settings. Omit the field to leave MQTT config unchanged.",
            properties: {
              brokerUrl: {
                type: "string",
                description: "Broker URL (e.g. mqtt://192.168.1.10:1883). Set to empty string to disable."
              },
              clientId: {
                type: "string",
                description: "Client identifier. Leave blank to auto-generate."
              },
              username: { type: "string" },
              password: {
                type: "string",
                description: "Write-only. Always returned as empty string in GET responses."
              },
              ingestTopic: {
                type: "string",
                description: "Topic to subscribe to. Defaults to cmnd/sigvis/ingest when blank."
              },
              status: {
                type: "string",
                enum: ["connected", "connecting", "disconnected", "error"],
                readOnly: true
              },
              lastError: {
                type: "string",
                nullable: true,
                readOnly: true
              }
            }
          }
        }
      },
      /* ── Generator schemas ──────────────────────────────────────────── */
      GeneratorSummary: {
        type: "object",
        required: ["id", "name", "enabled", "intervalMs", "kind"],
        properties: {
          id:          { type: "string", format: "uuid" },
          name:        { type: "string" },
          enabled:     { type: "boolean" },
          intervalMs:  { type: "integer", minimum: 100, description: "Firing interval in milliseconds." },
          kind:        { type: "string", enum: ["custom", "prebuilt"] },
          prebuiltId:  { type: "string", nullable: true, description: "Prebuilt catalog ID. Present when kind is 'prebuilt'." },
          initError:   { type: "string", nullable: true },
          lastError:   { type: "string", nullable: true },
          configErrors: {
            type: "object",
            additionalProperties: { type: "string" },
            nullable: true,
            description: "Per-field config validation errors. Present when kind is 'prebuilt'."
          }
        }
      },
      GeneratorDetail: {
        allOf: [
          { $ref: "#/components/schemas/GeneratorSummary" },
          {
            type: "object",
            properties: {
              initCode: { type: "string", nullable: true, description: "Init script source (custom generators)." },
              code:     { type: "string", nullable: true, description: "Process script source (custom generators)." },
              config:   { type: "object", additionalProperties: true, nullable: true, description: "Config key-value map (prebuilt generators)." }
            }
          }
        ]
      },
      GeneratorWrite: {
        type: "object",
        description: "For custom generators supply `initCode`/`code`. For prebuilt generators supply `kind: 'prebuilt'`, `prebuiltId`, and `config`.",
        properties: {
          name:       { type: "string" },
          enabled:    { type: "boolean" },
          intervalMs: { type: "integer", minimum: 100 },
          kind:       { type: "string", enum: ["custom", "prebuilt"], description: "Defaults to 'custom' if omitted." },
          initCode:   { type: "string", description: "Init script (custom). Optional." },
          code:       { type: "string", description: "Process script (custom). Required on POST for custom generators." },
          prebuiltId: { type: "string", description: "Catalog ID (prebuilt). Required when kind is 'prebuilt'." },
          config:     { type: "object", additionalProperties: true, description: "Config values (prebuilt)." },
          clearState: { type: "boolean", description: "When true, resets in-memory state and re-runs the init function/script." }
        }
      },
      GeneratorListResponse: {
        type: "object",
        required: ["paused", "items"],
        properties: {
          paused: { type: "boolean", description: "True when the master pause is active (all intervals stopped regardless of individual enabled flags)." },
          items:  { type: "array", items: { $ref: "#/components/schemas/GeneratorSummary" } }
        }
      },
      /* ── Processor schemas ───────────────────────────────────────────── */
      ProcessorSummary: {
        type: "object",
        required: ["id", "name", "enabled", "kind"],
        properties: {
          id:      { type: "string", format: "uuid" },
          name:    { type: "string" },
          enabled: { type: "boolean" },
          kind:    { type: "string", enum: ["custom", "prebuilt"] },
          prebuiltId: { type: "string", nullable: true, description: "Prebuilt catalog ID. Present when kind is 'prebuilt'." },
          initError: { type: "string", nullable: true },
          lastError: {
            type: "string",
            nullable: true,
            description: "Error message from the most recent execution, or null if the last run succeeded."
          },
          configErrors: {
            type: "object",
            additionalProperties: { type: "string" },
            nullable: true,
            description: "Per-field config validation errors. Present when kind is 'prebuilt'."
          }
        }
      },
      ProcessorDetail: {
        allOf: [
          { $ref: "#/components/schemas/ProcessorSummary" },
          {
            type: "object",
            properties: {
              initCode: { type: "string", nullable: true, description: "Init script source (custom processors)." },
              code:     { type: "string", nullable: true, description: "Process script source (custom processors)." },
              config:   { type: "object", additionalProperties: true, nullable: true, description: "Config key-value map (prebuilt processors)." }
            }
          }
        ]
      },
      ProcessorWrite: {
        type: "object",
        description: "For custom processors supply `initCode`/`code`. For prebuilt processors supply `kind: 'prebuilt'`, `prebuiltId`, and `config`.",
        properties: {
          name:       { type: "string" },
          enabled:    { type: "boolean" },
          kind:       { type: "string", enum: ["custom", "prebuilt"], description: "Defaults to 'custom' if omitted." },
          initCode:   { type: "string", description: "Init script (custom). Optional." },
          code:       { type: "string", description: "Process script (custom). Required on POST for custom processors." },
          prebuiltId: { type: "string", description: "Catalog ID (prebuilt). Required when kind is 'prebuilt'." },
          config:     { type: "object", additionalProperties: true, description: "Config values (prebuilt)." },
          clearState: { type: "boolean", description: "When true, resets in-memory state and re-runs the init function/script." }
        }
      },
      DashboardPayload: {
        type: "object",
        required: ["widgets"],
        properties: {
          name: { type: "string", nullable: true },
          widgets: {
            type: "array",
            items: { type: "object", additionalProperties: true }
          },
          runtimeSettings: {
            type: "object",
            properties: {
              renderHz: { type: "number" },
              pointsToRequest: { type: "integer" }
            }
          }
        }
      }
    }
  }
};

module.exports = {
  OPENAPI_SPEC
};
