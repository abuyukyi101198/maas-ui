import React, { useEffect, useState } from "react";

import { ContentSection } from "@canonical/maas-react-components";
import type { MultiSelectItem } from "@canonical/react-components";
import {
  MultiSelect,
  ActionButton,
  Button,
  Form,
} from "@canonical/react-components";
import { Field, Formik } from "formik";
import { useDispatch, useSelector } from "react-redux";

import { useSidePanel } from "@/app/base/side-panel-context";
import { bootResourceActions } from "@/app/store/bootresource";
import bootResourceSelectors from "@/app/store/bootresource/selectors";
import type {
  BootResourceUbuntuArch,
  BootResourceUbuntuRelease,
} from "@/app/store/bootresource/types";

import "./_index.scss";

type GroupedImages = {
  [key: string]: ReleasesWithArches;
};

type ReleasesWithArches = {
  [key: string]: MultiSelectItem[];
};

type ImagesByName = { [key: string]: DownloadableImage[] };

type DownloadableImage = {
  id: string;
  name: string;
  release: string;
  architectures: string;
};

const getDownloadableImages = (
  releases: BootResourceUbuntuRelease[],
  architectures: BootResourceUbuntuArch[]
) => {
  return releases
    .map((image) => {
      return architectures.map((arch) => {
        return {
          id: `ubuntu-${image.title}-${arch.name}`,
          name: "Ubuntu",
          release: image.title,
          architectures: arch.name,
        };
      });
    })
    .flat();
};

const groupImagesByName = (images: DownloadableImage[]) => {
  let imagesByName: ImagesByName = {};

  images.forEach((image) => {
    if (!!imagesByName[image.name]) {
      imagesByName[image.name].push(image);
    } else {
      imagesByName[image.name] = [image];
    }
  });

  Object.keys(imagesByName).forEach((distro) => {
    imagesByName[distro].sort((a, b) => {
      return b.release.localeCompare(a.release);
    });
  });

  return imagesByName;
};

const groupArchesByRelease = (images: ImagesByName) => {
  let groupedImages: GroupedImages = {};

  Object.keys(images).forEach((distro) => {
    if (!groupedImages[distro]) {
      groupedImages[distro] = {};
    }
    images[distro].forEach((image) => {
      if (!groupedImages[distro][image.release]) {
        groupedImages[distro][image.release] = [
          { label: image.architectures.toString(), value: image.id },
        ];
      } else {
        groupedImages[distro][image.release].push({
          label: image.architectures.toString(),
          value: image.id,
        });
      }
    });
  });

  return groupedImages;
};

const getInitialState = (images: ImagesByName) => {
  let initialState: ReleasesWithArches = {};

  Object.keys(images).forEach((distro) => {
    images[distro].forEach((image) => {
      if (!initialState[getValueKey(distro, image.release)]) {
        initialState[getValueKey(distro, image.release)] = [];
      }
    });
  });

  return initialState;
};

const getValueKey = (distro: string, release: string) =>
  `${distro}-${release}`.replace(".", "-");

const DownloadImages: React.FC = () => {
  const dispatch = useDispatch();
  const ubuntu = useSelector(bootResourceSelectors.ubuntu);

  const [images, setImages] = useState<ImagesByName>({});
  const [groupedImages, setGroupedImages] = useState<GroupedImages>({});
  const [initialValues, setInitialValues] = useState<ReleasesWithArches>({});

  useEffect(() => {
    if (ubuntu) {
      const downloadableImages = getDownloadableImages(
        ubuntu.releases,
        ubuntu.arches
      );
      const imagesByName = groupImagesByName(downloadableImages);
      setImages(imagesByName);
      setGroupedImages(groupArchesByRelease(imagesByName));
      setInitialValues(getInitialState(imagesByName));
    }
  }, [ubuntu]);

  useEffect(() => {
    return () => {
      dispatch(bootResourceActions.cleanup());
    };
  }, [dispatch]);

  const { setSidePanelContent } = useSidePanel();

  const resetForm = () => {
    setSidePanelContent(null);
    setInitialValues(images ? getInitialState(images) : {});
  };

  return (
    <ContentSection>
      <>
        <ContentSection.Content>
          <Formik
            enableReinitialize={true}
            initialValues={initialValues}
            onSubmit={(values) => console.log(values)}
          >
            {({ isSubmitting, dirty, values, setFieldValue }) => (
              <Form>
                {Object.keys(groupedImages).map((distro) => (
                  <span key={distro}>
                    <h2 className="p-heading--4">{distro} images</h2>
                    <table className="download-images-table">
                      <thead>
                        <tr>
                          <th>Release</th>
                          <th>Architecture</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(groupedImages[distro]).map((release) => (
                          <tr aria-label={release} key={release}>
                            <td>{release}</td>
                            <td>
                              <Field
                                as={MultiSelect}
                                items={groupedImages[distro][release]}
                                name={`${distro}-${release}`}
                                onItemsUpdate={(items: MultiSelectItem) =>
                                  setFieldValue(
                                    getValueKey(distro, release),
                                    items
                                  )
                                }
                                placeholder="Select architectures"
                                selectedItems={
                                  values[getValueKey(distro, release)]
                                }
                                variant="condensed"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </span>
                ))}
                <ContentSection.Footer>
                  <Button appearance="base" onClick={resetForm} type="button">
                    Cancel
                  </Button>
                  <ActionButton
                    appearance="positive"
                    disabled={!dirty || isSubmitting}
                    loading={isSubmitting}
                    type="submit"
                  >
                    Save
                  </ActionButton>
                </ContentSection.Footer>
              </Form>
            )}
          </Formik>
        </ContentSection.Content>
      </>
    </ContentSection>
  );
};

export default DownloadImages;
