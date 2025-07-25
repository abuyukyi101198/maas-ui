import { useState } from "react";

import {
  Col,
  ContextualMenu,
  MainTable,
  Row,
  Strip,
  Spinner,
} from "@canonical/react-components";
import classNames from "classnames";
import { useSelector } from "react-redux";
import { Link } from "react-router";

import DeleteRecordForm from "./DeleteRecordForm";
import EditRecordForm from "./EditRecordForm";

import { useGetIsSuperUser } from "@/app/api/query/auth";
import urls from "@/app/base/urls";
import domainsSelectors from "@/app/store/domain/selectors";
import type { Domain, DomainResource } from "@/app/store/domain/types";
import { isDomainDetails } from "@/app/store/domain/utils";
import type { RootState } from "@/app/store/root/types";
import { NodeType } from "@/app/store/types/node";

enum RecordActions {
  DELETE = "delete",
  EDIT = "edit",
}

export enum Labels {
  NoRecords = "Domain contains no records.",
}

type Expanded = {
  content: RecordActions;
  id: string;
};

type Props = {
  id: Domain["id"];
};

const generateRowId = (resource: DomainResource, i: number) =>
  `${resource.dnsresource_id}-${i}`;

const ResourceRecords = ({ id }: Props): React.ReactElement | null => {
  const domain = useSelector((state: RootState) =>
    domainsSelectors.getById(state, id)
  );
  const loading = useSelector(domainsSelectors.loading);

  const isSuperUser = useGetIsSuperUser();

  const [expanded, setExpanded] = useState<Expanded | null>(null);

  if (loading) {
    return (
      <Strip shallow>
        <Spinner text="Loading..." />
      </Strip>
    );
  }
  if (!isDomainDetails(domain)) {
    return null;
  }

  const headers = [
    {
      content: "Name",
      sortKey: "name",
    },
    {
      content: "Type",
      sortKey: "type",
    },
    {
      content: "TTL",
      sortKey: "ttl",
    },
    {
      content: "Data",
      sortKey: "data",
    },
    {
      content: "Actions",
      className: "u-align--right",
    },
  ];

  const rows = domain.rrsets.map((resource, i) => {
    const rowId = generateRowId(resource, i);
    const isExpanded = rowId === expanded?.id;
    let nameCell = <>{resource.name}</>;

    // We can't edit records that don't have a dnsresource_id.
    // (If the row doesn't have one, it has probably been automatically
    // generated by means of a deployed node, or some other reason.)
    const isAutogenerated = !resource.dnsresource_id;
    const canEdit = !isAutogenerated && isSuperUser.data;

    if (resource.node_type != null && resource.system_id !== null) {
      switch (resource.node_type) {
        case NodeType.MACHINE:
          nameCell = (
            <Link to={urls.machines.machine.index({ id: resource.system_id })}>
              {resource.name}
            </Link>
          );
          break;
        case NodeType.DEVICE:
          nameCell = (
            <Link to={urls.devices.device.index({ id: resource.system_id })}>
              {resource.name}
            </Link>
          );
          break;
        case NodeType.RACK_CONTROLLER:
        case NodeType.REGION_CONTROLLER:
        case NodeType.REGION_AND_RACK_CONTROLLER:
          nameCell = (
            <Link
              to={urls.controllers.controller.index({
                id: resource.system_id,
              })}
            >
              {resource.name}
            </Link>
          );
          break;
      }
    }

    return {
      className: classNames("p-table__row", { "is-active": isExpanded }),
      columns: [
        {
          content: nameCell,
        },
        {
          content: resource.rrtype,
        },
        {
          content: resource.ttl || "(default)",
        },
        {
          content: resource.rrdata,
        },
        {
          content: (
            <ContextualMenu
              hasToggleIcon={true}
              links={[
                {
                  children: "Edit record...",
                  onClick: () => {
                    setExpanded({
                      content: RecordActions.EDIT,
                      id: rowId,
                    });
                  },
                },
                {
                  children: "Remove record...",
                  onClick: () => {
                    setExpanded({
                      content: RecordActions.DELETE,
                      id: rowId,
                    });
                  },
                },
              ]}
              toggleAppearance="base"
              toggleClassName="u-no-margin--bottom is-small is-dense"
              toggleDisabled={!canEdit}
            />
          ),
          className: "u-align--right",
        },
      ],
      sortData: {
        name: resource.name,
        type: resource.rrtype,
        ttl: resource.ttl,
        data: resource.rrdata,
      },
      expanded: isExpanded,
      expandedContent: isExpanded ? (
        <Row>
          <Col size={12}>
            <hr />
            <>
              {expanded?.content === RecordActions.EDIT && (
                <EditRecordForm
                  closeForm={() => {
                    setExpanded(null);
                  }}
                  id={id}
                  resource={resource}
                />
              )}
              {expanded?.content === RecordActions.DELETE && (
                <DeleteRecordForm
                  closeForm={() => {
                    setExpanded(null);
                  }}
                  id={id}
                  resource={resource}
                />
              )}
            </>
          </Col>
        </Row>
      ) : null,
    };
  });

  return (
    <Strip shallow>
      <Row>
        <Col size={12}>
          <h3 className="p-heading--4">Resource records</h3>
          <MainTable
            className="p-table-expanding--light"
            defaultSort="name"
            defaultSortDirection="ascending"
            expanding
            headers={headers}
            paginate={50}
            rows={rows}
            sortable
          />
          {domain.rrsets.length === 0 && (
            <Strip rowClassName="u-align--center" shallow>
              <span data-testid="no-records">{Labels.NoRecords}</span>
            </Strip>
          )}
        </Col>
      </Row>
    </Strip>
  );
};

export default ResourceRecords;
