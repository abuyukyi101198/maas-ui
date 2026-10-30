import { HttpResponse } from "msw";

import type {
  CreateZoneError,
  DeleteZoneError,
  GetZoneError,
  ListZonesError,
  ListZonesResponse,
  ListZonesWithStatisticsError,
  UpdateZoneError,
  ZoneResponse,
  ZonesWithStatisticsListResponse,
} from "@/app/apiclient";
import {
  zone as zoneFactory,
  zoneWithStatistics as zoneStatsFactory,
} from "@/testing/factories";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockZones: ListZonesResponse = {
  items: [
    zoneFactory({
      id: 1,
      name: "zone-1",
      description: "",
    }),
    zoneFactory({
      id: 2,
      name: "zone-2",
      description: "",
    }),
    zoneFactory({
      id: 3,
      name: "zone-3",
      description: "",
    }),
  ],
  total: 3,
};

const mockZonesWithStatistics: ZonesWithStatisticsListResponse = {
  items: [
    zoneStatsFactory({
      id: 1,
      controllers_count: 2,
      devices_count: 5,
      machines_count: 10,
    }),
    zoneStatsFactory({
      id: 2,
      controllers_count: 1,
      devices_count: 3,
      machines_count: 6,
    }),
    zoneStatsFactory({
      id: 3,
      controllers_count: 0,
      devices_count: 2,
      machines_count: 4,
    }),
  ],
  total: 3,
};

const mockListZonesError: ListZonesError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockListZonesWithStatisticsError: ListZonesWithStatisticsError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockGetZoneError: GetZoneError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockCreateZoneError: CreateZoneError = {
  message: "Zone already exists",
  code: 409,
  kind: "Error",
};

const mockUpdateZoneError: UpdateZoneError = {
  message: "Bad request",
  code: 400,
  kind: "Error",
};

const mockDeleteZoneError: DeleteZoneError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const zoneResolvers = {
  listZones: createResolver({
    method: "get",
    path: "zones",
    data: mockZones,
    error: mockListZonesError,
  }),
  listZonesWithStatistics: createResolver({
    method: "get",
    path: "zones:statistics",
    data: mockZonesWithStatistics,
    error: mockListZonesWithStatisticsError,
  }),
  getZone: createResolver({
    method: "get",
    path: "zones/:id",
    error: mockGetZoneError,
    respond: (data: ZoneResponse | undefined, { params }) => {
      const zone =
        data ?? mockZones.items.find((zone) => zone.id === Number(params.id));
      return zone ? HttpResponse.json(zone) : notFound();
    },
  }),
  createZone: createResolver({
    method: "post",
    path: "zones",
    data: { id: 1 },
    error: mockCreateZoneError,
  }),
  updateZone: createResolver({
    method: "put",
    path: "zones/:id",
    data: {},
    error: mockUpdateZoneError,
  }),
  deleteZone: createResolver({
    method: "delete",
    path: "zones/:id",
    data: {},
    status: 204,
    error: mockDeleteZoneError,
  }),
};

export { zoneResolvers, mockZones, mockZonesWithStatistics };
