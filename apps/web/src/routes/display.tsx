import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";

import { mouseQuery, searchState } from "../device/queries";
import { ConnectEmpty } from "../screens/connect";
import { DisplayScreen } from "../screens/display";

const route = getRouteApi("/display");

const DisplayRoute = () => {
  const source = route.useSearch().state ?? "device";
  const { data } = useSuspenseQuery(mouseQuery(source));

  return data.link === "none" ? (
    <ConnectEmpty source={source} />
  ) : (
    <DisplayScreen snapshot={data} source={source} />
  );
};

export const Route = createFileRoute("/display")({
  component: DisplayRoute,
  validateSearch: searchState,
});
