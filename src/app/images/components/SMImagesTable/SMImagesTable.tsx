import React, { useState } from "react";

import type { RowSelectionState } from "@tanstack/react-table";
import { useSelector } from "react-redux";

import ImagesTableHeader from "./ImagesTableHeader";
import useImageTableColumns, {
  filterCells,
  filterHeaders,
} from "./useImageTableColumns/useImageTableColumns";

import GenericTable from "@/app/images/components/GenericTable";
import type { Image } from "@/app/images/types";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type { BootResource } from "@/app/store/bootresource/types";
import { splitResourceName } from "@/app/store/bootresource/utils";
import configSelectors from "@/app/store/config/selectors";

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

export const SMImagesTable: React.FC = () => {
  const ubuntu = useSelector(bootResourceSelectors.ubuntu);
  const resources = useSelector(bootResourceSelectors.resources);
  const images = getImages(resources);

  const commissioningRelease = useSelector(
    configSelectors.commissioningDistroSeries
  );

  const [selectedRows, setSelectedRows] = useState<RowSelectionState>({});

  const columns = useImageTableColumns({ commissioningRelease });

  return (
    <>
      {!!ubuntu && <ImagesTableHeader selectedRows={selectedRows} />}
      <GenericTable
        columns={columns}
        data={images}
        filterCells={filterCells}
        filterHeaders={filterHeaders}
        getRowId={(row) => `${row.id}`}
        groupBy={["name"]}
        rowSelection={selectedRows}
        setRowSelection={setSelectedRows}
        sortBy={[{ id: "release", desc: true }]}
      />
    </>
  );
};

export default SMImagesTable;
