import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { mouseQuery, searchState } from "../device/queries";
import { ConnectEmpty } from "../screens/connect";
import { DpiStages } from "../screens/dpi";

const route = getRouteApi("/dpi");

const DpiScreen = () => {
  const source = route.useSearch().state ?? "device";
  const { data } = useSuspenseQuery(mouseQuery(source));

  return data.link === "none" ? (
    <ConnectEmpty source={source} />
  ) : (
    <DpiStages snapshot={data} source={source} />
  );
};

export const Route = createFileRoute("/dpi")({
  component: DpiScreen,
  validateSearch: searchState,
});
