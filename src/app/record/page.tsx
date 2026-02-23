import { redirect } from "next/navigation";

type SearchValue = string | string[] | undefined;

function toQuery(searchParams: Record<string, SearchValue>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      query.set(key, value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        query.append(key, item);
      }
    }
  }
  query.set("from", "record");
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function RecordRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>;
}) {
  const resolved = await searchParams;
  redirect(`/lesson${toQuery(resolved)}`);
}
