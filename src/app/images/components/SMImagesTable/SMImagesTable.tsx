import React, { useMemo, useState } from "react";

import { DynamicTable } from "@canonical/maas-react-components";
import { Button } from "@canonical/react-components";
import type {
  Column,
  ExpandedState,
  GroupingState,
  Header,
  Row,
  SortingState,
} from "@tanstack/react-table";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import classNames from "classnames";
import { useSelector } from "react-redux";

import SortIndicator from "@/app/images/components/SMImagesTable/SortIndicator/SortIndicator";
import useSMImagesTableColumns from "@/app/images/components/SMImagesTable/useSMImagesTableColumns/useSMImagesTableColumns";
import "./_index.scss";
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
  const resources = [
    ...useSelector(bootResourceSelectors.ubuntuResources),
    ...useSelector(bootResourceSelectors.ubuntuCoreResources),
    ...useSelector(bootResourceSelectors.otherResources),
  ];
  const images = getImages(resources);

  const commissioningRelease = useSelector(
    configSelectors.commissioningDistroSeries
  );

  const columns = useSMImagesTableColumns({ commissioningRelease });
  // const noItems = useMemo<Image[]>(() => [], []);

  const [grouping, setGrouping] = useState<GroupingState>(["name"]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "release", desc: true },
  ]);

  const sortedImages = useMemo(() => {
    return images.sort((a, b) => {
      const column = sorting[0] ?? { id: "release", desc: true };
      if (column.id === "release") {
        if (!column.desc) {
          return a.release.localeCompare(b.release);
        } else {
          return b.release.localeCompare(a.release);
        }
      }
      return 0;
    });
  }, [images, sorting]);

  const table = useReactTable<Image>({
    data: sortedImages,
    columns,
    state: {
      grouping,
      expanded,
      sorting,
    },
    manualPagination: true,
    autoResetExpanded: false,
    onExpandedChange: setExpanded,
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    manualSorting: true,
    enableSorting: true,
    enableExpanding: true,
    getExpandedRowModel: getExpandedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    groupedColumnMode: false,
    enableRowSelection: true,
    enableMultiRowSelection: true,
    getRowId: (row) => `${row.id}`,
  });

  return (
    <DynamicTable
      aria-label="images"
      className="p-table-dynamic--with-select images-table"
      variant={"full-height"}
    >
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.filter(filterHeaders).map((header) => (
              <th className={classNames(`${header.column.id}`)} key={header.id}>
                {header.column.getCanSort() ? (
                  <Button
                    appearance="link"
                    className="p-button--table-header"
                    onClick={header.column.getToggleSortingHandler()}
                    type="button"
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                    <SortIndicator header={header} />
                  </Button>
                ) : (
                  flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )
                )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      {
        // Error and pending states need to be implemented when integrating with the backend
        table.getRowModel().rows.length < 1 ? (
          <caption className="u-visually-hidden">No images</caption> // TableCaption.Title and TableCaption.Description implementation in Site Manager pretty clean, could copy over
        ) : (
          <DynamicTable.Body>
            {table.getRowModel().rows.map((row) => {
              const { getIsGrouped, id, index, getVisibleCells } = row;
              const isIndividualRow = !getIsGrouped();
              return (
                <tr
                  className={classNames({
                    "individual-row": isIndividualRow,
                    "group-row": !isIndividualRow,
                  })}
                  key={id + index}
                >
                  {getVisibleCells()
                    .filter((cell) => filterCells(row, cell.column))
                    .map((cell) => {
                      const { column, id: cellId } = cell;
                      return (
                        <td
                          className={classNames(`${cell.column.id}`)}
                          key={cellId}
                        >
                          {flexRender(column.columnDef.cell, cell.getContext())}
                        </td>
                      );
                    })}
                </tr>
              );
            })}
          </DynamicTable.Body>
        )
      }
    </DynamicTable>
  );
};

export default SMImagesTable;
