import type { ReactElement } from "react";
import { useEffect } from "react";

import PageContent from "@/app/base/components/PageContent";
import { useWindowTitle } from "@/app/base/hooks";
import { getSidePanelTitle, useSidePanel } from "@/app/base/side-panel-context";
import {
  AddSSLKey,
  DeleteSSLKey,
  SSLKeysTable,
} from "@/app/preferences/views/SSLKeys/components";
import { SSLKeyActionSidePanelViews } from "@/app/preferences/views/SSLKeys/constants";
import { isId } from "@/app/utils";

const SSLKeysList = (): ReactElement => {
  const { sidePanelContent, setSidePanelContent } = useSidePanel();

  useWindowTitle("SSL keys");

  const closeForm = () => {
    setSidePanelContent(null);
  };

  useEffect(() => {
    setSidePanelContent(null);
  }, [setSidePanelContent]);

  let content = null;

  if (
    sidePanelContent &&
    sidePanelContent.view === SSLKeyActionSidePanelViews.ADD_SSL_KEY
  ) {
    content = <AddSSLKey closeForm={closeForm} key="add-ssl-key-form" />;
  } else if (
    sidePanelContent &&
    sidePanelContent.view === SSLKeyActionSidePanelViews.DELETE_SSL_KEY
  ) {
    const sslKeyId =
      sidePanelContent.extras && "sslKeyId" in sidePanelContent.extras
        ? sidePanelContent.extras.sslKeyId
        : null;
    content = isId(sslKeyId) ? (
      <DeleteSSLKey closeForm={closeForm} id={sslKeyId} />
    ) : null;
  }

  return (
    <PageContent
      sidePanelContent={content}
      sidePanelTitle={getSidePanelTitle("SSL keys", sidePanelContent)}
    >
      <SSLKeysTable />
    </PageContent>
  );
};

export default SSLKeysList;
