import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { mouseQuery, searchState } from "../device/queries";
import { BackupStep, ConnectEmpty } from "../screens/connect";

const route = getRouteApi("/");

const ConnectScreen = () => {
  const source = route.useSearch().state ?? "device";
  const { data } = useSuspenseQuery(mouseQuery(source));

  return data.link === "none" ? (
    <ConnectEmpty source={source} />
  ) : (
    <BackupStep snapshot={data} source={source} />
  );
};

export const Route = createFileRoute("/")({
  component: ConnectScreen,
  validateSearch: searchState,
});
