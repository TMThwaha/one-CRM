import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/http/session";

export default async function Home() {
  redirect((await getAuthContext()) ? "/dashboard" : "/login");
}
