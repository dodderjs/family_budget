import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const api = axios.create({
  baseURL: API_URL,
});

/** StrictMode double-invokes every effect in dev, and independent components
 * legitimately ask for the same reference data at once (accounts, categories) -
 * either way two identical GETs end up in flight together. Share the first
 * one's promise so the backend only sees one. Only GETs: they're the read-only
 * ones, collapsing a POST/PATCH/DELETE would silently drop a write. */
const inFlightGets = new Map<string, Promise<unknown>>();

const rawGet: typeof api.get = api.get.bind(api);

function dedupedGet<T = any, R = AxiosResponse<T>, D = any>(
  url: string,
  config?: AxiosRequestConfig<D>
): Promise<R> {
  const key = `${url}|${JSON.stringify(config?.params ?? null)}`;
  const pending = inFlightGets.get(key) as Promise<R> | undefined;
  if (pending) return pending;

  const request = rawGet<T, R, D>(url, config).finally(() => {
    inFlightGets.delete(key);
  });
  inFlightGets.set(key, request);
  return request;
}

api.get = dedupedGet;

export default api;
