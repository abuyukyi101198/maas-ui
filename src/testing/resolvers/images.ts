import type {
  BulkCreateSelectionsError,
  ImageListResponse,
  ImageStatisticListResponse,
  ImageStatusListResponse,
  ListSelectionsError,
  ListSelectionStatisticError,
  ListSelectionStatusError,
  UiSourceAvailableImageListResponse,
} from "@/app/apiclient";
import {
  availableImageFactory,
  imageFactory,
  imageStatisticsFactory,
  imageStatusFactory,
} from "@/testing/factories/image";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSelections: ImageListResponse = {
  items: [
    imageFactory.build({
      os: "ubuntu",
      release: "noble",
      title: "24.04 LTS",
    }),
    imageFactory.build({
      os: "ubuntu",
      release: "jammy",
      title: "22.04 LTS",
    }),
    imageFactory.build({
      os: "centos",
      release: "centos7",
      title: "7.0",
    }),
  ],
  total: 3,
};

const mockStatistics: ImageStatisticListResponse = {
  items: imageStatisticsFactory.buildList(3),
  total: 3,
};

const mockStatuses: ImageStatusListResponse = {
  items: imageStatusFactory.buildList(3),
  total: 3,
};

const mockAvailableSelections: UiSourceAvailableImageListResponse = {
  items: [
    availableImageFactory.build({
      os: "ubuntu",
      release: "noble",
      title: "24.04 LTS",
      architecture: "amd64",
    }),
    availableImageFactory.build({
      os: "ubuntu",
      release: "noble",
      title: "24.04 LTS",
      architecture: "arm64",
    }),
    availableImageFactory.build({
      os: "ubuntu",
      release: "jammy",
      title: "22.04 LTS",
      architecture: "amd64",
    }),
    availableImageFactory.build({
      os: "centos",
      release: "centos7",
      title: "7.0",
      architecture: "amd64",
    }),
  ],
};

const mockListImagesError: ListSelectionsError = {
  message: "Invalid",
  code: 422,
  kind: "Error",
};

const mockListImageStatisticsError: ListSelectionStatisticError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockListImageStatusesError: ListSelectionStatusError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockSaveSelectionsError: BulkCreateSelectionsError = {
  message: "Conflict",
  code: 409,
  kind: "Error",
};

const imageResolvers = {
  listSelections: createResolver({
    method: "get",
    path: "selections",
    data: mockSelections,
    error: mockListImagesError,
  }),
  listSelectionStatistics: createResolver({
    method: "get",
    path: "selections/statistics",
    data: mockStatistics,
    error: mockListImageStatisticsError,
  }),
  listSelectionStatuses: createResolver({
    method: "get",
    path: "selections/statuses",
    data: mockStatuses,
    error: mockListImageStatusesError,
  }),
  listCustomImages: createResolver<ImageListResponse, ListSelectionsError>({
    method: "get",
    path: "custom_images",
    data: { items: [], total: 0 },
    error: mockListImagesError,
  }),
  listCustomImageStatistics: createResolver<
    ImageStatisticListResponse,
    ListSelectionStatisticError
  >({
    method: "get",
    path: "custom_images/statistics",
    data: { items: [], total: 0 },
    error: mockListImageStatisticsError,
  }),
  listCustomImageStatuses: createResolver<
    ImageStatusListResponse,
    ListSelectionStatusError
  >({
    method: "get",
    path: "custom_images/statuses",
    data: { items: [], total: 0 },
    error: mockListImageStatusesError,
  }),
  listAvailableSelections: createResolver({
    method: "get",
    path: "available_images",
    data: mockAvailableSelections,
    error: mockListImagesError,
  }),
  addSelections: createResolver({
    method: "post",
    path: "selections",
    data: mockSelections,
    error: mockSaveSelectionsError,
  }),
  deleteSelections: createResolver({
    method: "delete",
    path: "selections",
    data: {},
    status: 204,
    error: mockSaveSelectionsError,
  }),
  uploadCustomImage: createResolver({
    method: "post",
    path: "custom_images",
    data: {},
    status: 201,
    error: mockSaveSelectionsError,
  }),
  deleteCustomImages: createResolver({
    method: "delete",
    path: "custom_images",
    data: {},
    status: 204,
    error: mockSaveSelectionsError,
  }),
};

export {
  imageResolvers,
  mockSelections,
  mockStatistics,
  mockStatuses,
  mockAvailableSelections,
};
