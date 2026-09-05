import { ColTypeDefs } from "ag-grid-enterprise";


export const columnTypes:(accounts: any[]) => ColTypeDefs = (accounts) => {
  const accountNameById = Object.fromEntries(accounts.map((a) => [a.id, a.name]))
  return {
    account: {
      filter: false,
      valueGetter: (params: any) => accountNameById[params.data.account_id] || params.data.account_id,
    },

      shaded: {

        cellClass: "shaded-class",

      },

    }};
