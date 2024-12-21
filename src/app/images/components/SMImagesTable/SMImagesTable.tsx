import React, { useState } from "react";

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

import SortIndicator from "@/app/images/components/SMImagesTable/SortIndicator/SortIndicator";
import useSMImagesTableColumns from "@/app/images/components/SMImagesTable/useSMImagesTableColumns/useSMImagesTableColumns";

import "./SMImagesTable.scss";

export type Image = {
  id: number;
  release: string;
  architecture: string;
  name: string;
  size: number;
  lastSynced: string | null; // ISO 8601 date string
  canDeployToMemory: boolean;
  status: string;
};

// export type SMImagesTableProps = {
//   images: ImageValue[];
//   resources: BootResource[];
// };

const dummyData: Image[] = [
  {
    id: 1,
    release: "20.04",
    architecture: "amd64",
    name: "Ubuntu 20.04",
    size: 1200000,
    lastSynced: "Sat, 21 Dec. 2024 13:45:23",
    canDeployToMemory: true,
    status: "Synced",
  },
  {
    id: 2,
    release: "22.04",
    architecture: "arm64",
    name: "Ubuntu 22.04",
    size: 1400000,
    lastSynced: null,
    canDeployToMemory: false,
    status: "Queued for download",
  },
  {
    id: 3,
    release: "22.04",
    architecture: "amd64",
    name: "Ubuntu 22.04",
    size: 1200000,
    lastSynced: "Sat, 21 Dec. 2024 13:45:23",
    canDeployToMemory: true,
    status: "Synced",
  },
  {
    id: 4,
    release: "18.04",
    architecture: "armhf",
    name: "Ubuntu 18.04",
    size: 1600000,
    lastSynced: null,
    canDeployToMemory: false,
    status: "Downloading 53%",
  },
];

const filterHeaders = (header: Header<Image, unknown>) =>
  header.column.id !== "name";

const filterCells = (row: Row<Image>, column: Column<Image, unknown>) => {
  if (row.getIsGrouped()) {
    return ["select", "name", "action"].includes(column.id);
  } else {
    return column.id !== "name";
  }
};

export const SMImagesTable: React.FC = () => {
  const columns = useSMImagesTableColumns();
  // const noItems = useMemo<Image[]>(() => [], []);

  const [grouping, setGrouping] = useState<GroupingState>(["name"]);
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "name", desc: false },
  ]);

  const table = useReactTable<Image>({
    data: dummyData,
    columns,
    state: {
      // RowSelectionContext alternative needed
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
    // onRowSelectionChange: setRowSelection, // RowSelectionContext alternative needed
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
