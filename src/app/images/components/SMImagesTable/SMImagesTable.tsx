import React, { useMemo, useState } from "react";

import { DynamicTable } from "@canonical/maas-react-components";
import { Button } from "@canonical/react-components";
import type {
  ExpandedState,
  GroupingState,
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
import type { ImageValue } from "@/app/images/types";
import type { BootResource } from "@/app/store/bootresource/types";

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

export type SMImagesTableProps = {
  images: ImageValue[];
  resources: BootResource[];
};

const dummyData: Image[] = [
  {
    id: 1,
    release: "20.04",
    architecture: "amd64",
    name: "Ubuntu 20.04",
    size: 1.2,
    lastSynced: "2021-10-01T12:00:00Z",
    canDeployToMemory: true,
    status: "Synced",
  },
  {
    id: 2,
    release: "22.04",
    architecture: "arm64",
    name: "Ubuntu 22.04",
    size: 1.4,
    lastSynced: "2021-10-01T12:00:00Z",
    canDeployToMemory: false,
    status: "Queued for download",
  },
];

export const SMImagesTable: React.FC<SMImagesTableProps> = ({
  images,
  resources,
}) => {
  const columns = useSMImagesTableColumns();
  const noItems = useMemo<Image[]>(() => [], []);

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
            {headerGroup.headers.map((header) => (
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
        // Table body
      }
    </DynamicTable>
  );
};
