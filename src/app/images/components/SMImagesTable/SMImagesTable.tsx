import React from "react";

import type { Column, Header, Row } from "@tanstack/react-table";
import { useSelector } from "react-redux";

import useImageTableColumns from "./useImageTableColumns/useImageTableColumns";

import GenericTable from "@/app/images/components/GenericTable";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type { BootResource } from "@/app/store/bootresource/types";
import { splitResourceName } from "@/app/store/bootresource/utils";
import configSelectors from "@/app/store/config/selectors";

export type Image = {
  id: number;
  release: string;
  architecture: string;
  name: string;
  size: string;
  lastSynced: string | null; // ISO 8601 date string
  canDeployToMemory: boolean;
  status: string;
  resource: BootResource;
};

const getImages = (resources: BootResource[]): Image[] => {
  return resources.map((resource) => {
    const { os } = splitResourceName(resource.name);
    return {
      id: resource.id,
      release: resource.title,
      architecture: resource.arch,
      name: os[0].toUpperCase() + os.slice(1),
      size: resource.size,
      lastSynced: resource.lastUpdate,
      canDeployToMemory: resource.canDeployToMemory,
      status: resource.status,
      resource: resource,
    };
  });
};

const filterHeaders = (header: Header<Image, unknown>) =>
  header.column.id !== "name";

const filterCells = (row: Row<Image>, column: Column<Image>) => {
  if (row.getIsGrouped()) {
    return ["select", "name", "action"].includes(column.id);
  } else {
    return column.id !== "name";
  }
};

export const SMImagesTable: React.FC = () => {
  const resources = useSelector(bootResourceSelectors.resources);
  const images = getImages(resources);

  const commissioningRelease = useSelector(
    configSelectors.commissioningDistroSeries
  );

  const columns = useImageTableColumns({ commissioningRelease });

  return (
    <GenericTable
      columns={columns}
      data={images}
      filterCells={filterCells}
      filterHeaders={filterHeaders}
      getRowId={(row) => `${row.id}`}
      groupBy={["name"]}
      sortBy={[{ id: "release", desc: true }]}
    />
  );
};

export default SMImagesTable;
