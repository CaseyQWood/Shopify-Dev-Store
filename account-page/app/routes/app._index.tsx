import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { Modal, TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  addOneTimeLineToNextCycle,
  addRecurringLine,
  changeCycleBillingDate,
  getSubscriptionContractDetail,
  listRecentSubscriptionContracts,
  recordSubscriptionAdminAction,
  removeRecurringLine,
  searchSubscriptionContracts,
  shiftAllUpcomingCycles,
  skipNextBillingCycle,
  updateRecurringLine,
  type SubscriptionContract,
} from "../subscriptions/subscription-contracts.server";
import { formatShopifyError } from "../subscriptions/shopify-graphql.server";
import styles from "../styles/subscription-admin.module.css";

type ActionResult = {
  status: "success" | "error";
  message: string;
};

type SessionWithAdminEmail = {
  shop: string;
  email?: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const selectedContractId = url.searchParams.get("contractId")?.trim() ?? "";

  let contracts: SubscriptionContract[] = [];
  let selectedContract: SubscriptionContract | null = null;
  let subscriptionError: string | null = null;

  try {
    contracts = query
      ? await searchSubscriptionContracts(admin, query)
      : await listRecentSubscriptionContracts(admin);
  } catch (error) {
    subscriptionError = formatShopifyError(error);
  }

  try {
    selectedContract = selectedContractId
      ? await getSubscriptionContractDetail(admin, selectedContractId)
      : contracts[0]
        ? await getSubscriptionContractDetail(admin, contracts[0].id)
        : null;
  } catch (error) {
    subscriptionError = formatShopifyError(error);
  }

  return {
    query,
    selectedContractId,
    contracts,
    selectedContract,
    subscriptionError,
  };
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formPositiveInteger(formData: FormData, key: string) {
  const value = Number(formString(formData, key));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive whole number.`);
  }

  return value;
}

function buildAddLineInput(formData: FormData) {
  const productVariantId = formString(formData, "productVariantId");
  const currentPrice = formString(formData, "currentPrice");
  if (!productVariantId) throw new Error("Enter a product variant ID.");
  if (!currentPrice) throw new Error("Enter the current price for the line.");

  return {
    contractId: formString(formData, "contractId"),
    productVariantId,
    quantity: formPositiveInteger(formData, "quantity"),
    currentPrice,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, email } = session as SessionWithAdminEmail;
  const formData = await request.formData();
  const intent = formString(formData, "intent");
  const contractId = formString(formData, "contractId") || null;
  const actionName = intent || "unknown";

  try {
    switch (intent) {
      case "skip-next-cycle":
        await skipNextBillingCycle(admin, contractId ?? "");
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "SKIP_NEXT_CYCLE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Next unbilled cycle was skipped.",
        } satisfies ActionResult;

      case "shift-all-by-day": {
        const targetDay = formPositiveInteger(formData, "targetDay");
        if (targetDay > 31) {
          throw new Error("Target day must be between 1 and 31.");
        }
        const shiftResult = await shiftAllUpcomingCycles(
          admin,
          contractId ?? "",
          targetDay,
        );
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "SHIFT_ALL_CYCLES",
          contractId,
          status: "SUCCESS",
          metadata: { targetDay },
        });
        return {
          status: "success",
          message:
            shiftResult.message ??
            `Shifted ${shiftResult.shifted} upcoming cycle(s) to land on day ${targetDay} of the month.`,
        } satisfies ActionResult;
      }

      case "change-cycle-date": {
        const cycleIndex = formPositiveInteger(formData, "cycleIndex");
        const billingDate = formString(formData, "billingDate");
        await changeCycleBillingDate(
          admin,
          contractId ?? "",
          cycleIndex,
          billingDate,
        );
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "CHANGE_CYCLE_DATE",
          contractId,
          targetId: String(cycleIndex),
          status: "SUCCESS",
          metadata: { cycleIndex, billingDate },
        });
        return {
          status: "success",
          message: `Cycle #${cycleIndex} billing date updated.`,
        } satisfies ActionResult;
      }

      case "update-recurring-line":
        await updateRecurringLine(admin, {
          contractId: contractId ?? "",
          lineId: formString(formData, "lineId"),
          quantity: formPositiveInteger(formData, "quantity"),
          productVariantId: formString(formData, "productVariantId") || null,
          currentPrice: formString(formData, "currentPrice") || null,
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "UPDATE_RECURRING_LINE",
          contractId,
          targetId: formString(formData, "lineId"),
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was updated for future cycles.",
        } satisfies ActionResult;

      case "remove-recurring-line":
        await removeRecurringLine(
          admin,
          contractId ?? "",
          formString(formData, "lineId"),
        );
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "REMOVE_RECURRING_LINE",
          contractId,
          targetId: formString(formData, "lineId"),
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was removed for future cycles.",
        } satisfies ActionResult;

      case "add-recurring-line":
        await addRecurringLine(admin, buildAddLineInput(formData));
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_RECURRING_LINE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was added for future cycles.",
        } satisfies ActionResult;

      case "add-one-time-line":
        await addOneTimeLineToNextCycle(admin, buildAddLineInput(formData));
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_ONE_TIME_LINE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "One-time line was added to the next cycle only.",
        } satisfies ActionResult;

      default:
        throw new Error("Unknown subscription admin action.");
    }
  } catch (error) {
    const message = formatShopifyError(error);
    await recordSubscriptionAdminAction(prisma, {
      shop,
      adminEmail: email,
      action: actionName,
      contractId,
      status: "ERROR",
      message,
    });

    return { status: "error", message } satisfies ActionResult;
  }
};

function formatDate(iso: string | null) {
  if (!iso) return "Not scheduled";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatDateTime(iso: string | null) {
  if (!iso) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function statusClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return `${styles.badge} ${styles.badgeSuccess}`;
    case "PAUSED":
      return `${styles.badge} ${styles.badgeWarning}`;
    case "CANCELLED":
    case "EXPIRED":
    case "FAILED":
      return `${styles.badge} ${styles.badgeCritical}`;
    default:
      return styles.badge;
  }
}

function priceInputValue(value: string | null) {
  return value?.replace(/[^0-9.]/g, "") ?? "";
}

function SearchResults({
  contracts,
  query,
  selectedContract,
}: {
  contracts: SubscriptionContract[];
  query: string;
  selectedContract: SubscriptionContract | null;
}) {
  if (contracts.length === 0) {
    return (
      <div className={styles.emptyState}>
        No subscriptions matched this search.
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Customer</th>
            <th scope="col">Status</th>
            <th scope="col">Cadence</th>
            <th scope="col">Next billing</th>
            <th scope="col">Lines</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr
              key={contract.id}
              className={
                selectedContract?.id === contract.id ? styles.selectedRow : ""
              }
            >
              <td>
                <Link
                  to={`?q=${encodeURIComponent(query)}&contractId=${encodeURIComponent(contract.id)}`}
                  className={styles.idLink}
                >
                  #{contract.numericId}
                </Link>
              </td>
              <td>
                <div className={styles.customerCell}>
                  <span>{contract.customer.displayName}</span>
                  {contract.customer.email ? (
                    <small>{contract.customer.email}</small>
                  ) : null}
                </div>
              </td>
              <td>
                <span className={statusClass(contract.status)}>
                  {contract.status}
                </span>
              </td>
              <td>{contract.cadence}</td>
              <td>{formatDate(contract.displayNextBillingDate)}</td>
              <td>{contract.lineSummary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractSummary({ contract }: { contract: SubscriptionContract }) {
  return (
    <div className={styles.summaryGrid}>
      <div>
        <span className={styles.label}>Contract</span>
        <strong>#{contract.numericId}</strong>
      </div>
      <div>
        <span className={styles.label}>Status</span>
        <span className={statusClass(contract.status)}>{contract.status}</span>
      </div>
      <div>
        <span className={styles.label}>Customer</span>
        <strong>{contract.customer.displayName}</strong>
        {contract.customer.email ? <span>{contract.customer.email}</span> : null}
        {contract.customer.phone ? <span>{contract.customer.phone}</span> : null}
      </div>
      <div>
        <span className={styles.label}>Cadence</span>
        <strong>{contract.cadence}</strong>
      </div>
      <div>
        <span className={styles.label}>Next billing</span>
        <strong>{formatDate(contract.displayNextBillingDate)}</strong>
      </div>
      <div>
        <span className={styles.label}>Recent billing state</span>
        <strong>{contract.lastPaymentStatus ?? "No payment state"}</strong>
        {contract.lastBillingAttemptErrorType ? (
          <span>{contract.lastBillingAttemptErrorType}</span>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleActions({ contract }: { contract: SubscriptionContract }) {
  return (
    <div className={styles.actionGrid}>
      <Form method="post" className={styles.actionPanel}>
        <input type="hidden" name="intent" value="skip-next-cycle" />
        <input type="hidden" name="contractId" value={contract.id} />
        <h3>Skip next cycle</h3>
        <p>
          Applies a merchant-initiated skip to the next unbilled billing cycle.
        </p>
        <button type="submit" className={styles.button}>
          Skip next cycle
        </button>
      </Form>

      <Form method="post" className={styles.actionPanel}>
        <input type="hidden" name="intent" value="shift-all-by-day" />
        <input type="hidden" name="contractId" value={contract.id} />
        <h3>Shift all upcoming cycles</h3>
        <p>
          Pins every upcoming unbilled cycle to a specific day of the month,
          re-aligned at the contract&apos;s cadence ({contract.cadence}).
          Not supported for day-cadence contracts.
        </p>
        <label className={styles.field}>
          <span>Target day of month (1–31)</span>
          <input
            type="number"
            name="targetDay"
            min={1}
            max={31}
            step={1}
            required
          />
        </label>
        <button type="submit" className={styles.button}>
          Shift schedule
        </button>
      </Form>
    </div>
  );
}

type PickedVariant = { id: string; title: string };

const EDIT_PRODUCTS_MODAL_ID = "edit-products-modal";

function EditProductsModal({
  contract,
  actionData,
}: {
  contract: SubscriptionContract;
  actionData: { status: "success" | "error"; message: string } | undefined;
}) {
  const shopify = useAppBridge();
  const [open, setOpen] = useState(false);

  // Picker state for "add recurring"
  const [recurringVariant, setRecurringVariant] =
    useState<PickedVariant | null>(null);
  const [recurringQty, setRecurringQty] = useState("1");
  const [recurringPrice, setRecurringPrice] = useState("");

  // Picker state for "add one-time"
  const [oneTimeVariant, setOneTimeVariant] = useState<PickedVariant | null>(
    null,
  );
  const [oneTimeQty, setOneTimeQty] = useState("1");
  const [oneTimePrice, setOneTimePrice] = useState("");

  // Track the last intent that succeeded so we can reset the right section
  const prevActionRef = useRef<typeof actionData>(undefined);

  useEffect(() => {
    if (
      actionData &&
      actionData !== prevActionRef.current &&
      actionData.status === "success" &&
      open
    ) {
      // Reset add-recurring state
      setRecurringVariant(null);
      setRecurringQty("1");
      setRecurringPrice("");
      // Reset add-one-time state
      setOneTimeVariant(null);
      setOneTimeQty("1");
      setOneTimePrice("");
    }
    prevActionRef.current = actionData;
  }, [actionData, open]);

  async function openRecurringPicker() {
    const selection = await shopify.resourcePicker({
      type: "variant",
      multiple: false,
      action: "select",
    });
    if (selection && selection.length > 0) {
      const v = selection[0];
      setRecurringVariant({ id: v.id, title: v.displayName ?? v.id });
    }
  }

  async function openOneTimePicker() {
    const selection = await shopify.resourcePicker({
      type: "variant",
      multiple: false,
      action: "select",
    });
    if (selection && selection.length > 0) {
      const v = selection[0];
      setOneTimeVariant({ id: v.id, title: v.displayName ?? v.id });
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen(true)}
      >
        Edit products
      </button>

      <Modal
        id={EDIT_PRODUCTS_MODAL_ID}
        open={open}
        onHide={() => setOpen(false)}
      >
        <div className={styles.modalForm}>
          {/* ── Section 1: Existing lines ── */}
          <h3>Existing lines</h3>
          {contract.lines.length === 0 ? (
            <div className={styles.emptyState}>No lines on this contract.</div>
          ) : (
            <div className={styles.stack}>
              {contract.lines.map((line) => (
                <div key={line.id} className={styles.linePanel}>
                  <div className={styles.lineHeader}>
                    <div>
                      <h3>{line.title}</h3>
                      <p>
                        {line.variantTitle ?? "Default variant"} ·{" "}
                        {line.currentPrice ?? "No price"}
                      </p>
                    </div>
                    <span className={styles.badge}>Qty {line.quantity}</span>
                  </div>

                  <Form method="post" className={styles.inlineGrid}>
                    <input
                      type="hidden"
                      name="intent"
                      value="update-recurring-line"
                    />
                    <input
                      type="hidden"
                      name="contractId"
                      value={contract.id}
                    />
                    <input type="hidden" name="lineId" value={line.id} />
                    <label className={styles.field}>
                      <span>Quantity</span>
                      <input
                        type="number"
                        name="quantity"
                        min="1"
                        defaultValue={line.quantity}
                        required
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Variant ID</span>
                      <input
                        type="text"
                        name="productVariantId"
                        defaultValue={line.variantId ?? ""}
                        placeholder="gid://shopify/ProductVariant/..."
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Price override</span>
                      <input
                        type="text"
                        name="currentPrice"
                        defaultValue={priceInputValue(line.currentPrice)}
                        inputMode="decimal"
                      />
                    </label>
                    <button type="submit" className={styles.button}>
                      Save
                    </button>
                  </Form>

                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="remove-recurring-line"
                    />
                    <input
                      type="hidden"
                      name="contractId"
                      value={contract.id}
                    />
                    <input type="hidden" name="lineId" value={line.id} />
                    <button type="submit" className={styles.dangerButton}>
                      Remove recurring line
                    </button>
                  </Form>
                </div>
              ))}
            </div>
          )}

          {/* ── Section 2: Add recurring product ── */}
          <h3>Add recurring product</h3>
          <Form method="post" className={styles.stack}>
            <input type="hidden" name="intent" value="add-recurring-line" />
            <input type="hidden" name="contractId" value={contract.id} />
            <input
              type="hidden"
              name="productVariantId"
              value={recurringVariant?.id ?? ""}
            />
            <div className={styles.pickerField}>
              <span className={styles.pickerLabel}>Variant</span>
              <button
                type="button"
                className={styles.pickerButton}
                onClick={openRecurringPicker}
              >
                {recurringVariant ? "Change variant" : "Choose variant"}
              </button>
              {recurringVariant ? (
                <div className={styles.chipList}>
                  <span className={styles.chip}>
                    {recurringVariant.title}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`Remove ${recurringVariant.title}`}
                      onClick={() => setRecurringVariant(null)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ) : null}
            </div>
            <div className={styles.inlineGrid}>
              <label className={styles.field}>
                <span>Quantity</span>
                <input
                  type="number"
                  name="quantity"
                  min="1"
                  value={recurringQty}
                  onChange={(e) => setRecurringQty(e.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Price</span>
                <input
                  type="text"
                  name="currentPrice"
                  inputMode="decimal"
                  value={recurringPrice}
                  onChange={(e) => setRecurringPrice(e.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className={styles.button}
                disabled={!recurringVariant}
              >
                Add recurring
              </button>
            </div>
          </Form>

          {/* ── Section 3: Add one-time add-on ── */}
          <h3>Add one-time product to next cycle</h3>
          <Form method="post" className={styles.stack}>
            <input type="hidden" name="intent" value="add-one-time-line" />
            <input type="hidden" name="contractId" value={contract.id} />
            <input
              type="hidden"
              name="productVariantId"
              value={oneTimeVariant?.id ?? ""}
            />
            <div className={styles.pickerField}>
              <span className={styles.pickerLabel}>Variant</span>
              <button
                type="button"
                className={styles.pickerButton}
                onClick={openOneTimePicker}
              >
                {oneTimeVariant ? "Change variant" : "Choose variant"}
              </button>
              {oneTimeVariant ? (
                <div className={styles.chipList}>
                  <span className={styles.chip}>
                    {oneTimeVariant.title}
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`Remove ${oneTimeVariant.title}`}
                      onClick={() => setOneTimeVariant(null)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ) : null}
            </div>
            <div className={styles.inlineGrid}>
              <label className={styles.field}>
                <span>Quantity</span>
                <input
                  type="number"
                  name="quantity"
                  min="1"
                  value={oneTimeQty}
                  onChange={(e) => setOneTimeQty(e.target.value)}
                  required
                />
              </label>
              <label className={styles.field}>
                <span>Price</span>
                <input
                  type="text"
                  name="currentPrice"
                  inputMode="decimal"
                  value={oneTimePrice}
                  onChange={(e) => setOneTimePrice(e.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                className={styles.button}
                disabled={!oneTimeVariant}
              >
                Add to next cycle
              </button>
            </div>
          </Form>
        </div>

        <TitleBar title="Edit products">
          <button onClick={() => setOpen(false)}>Done</button>
        </TitleBar>
      </Modal>
    </>
  );
}

function toLocalInputValue(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const CYCLE_MODAL_ID = "cycle-date-modal";

function BillingCycles({ contract }: { contract: SubscriptionContract }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  if (contract.upcomingBillingCycles.length === 0) {
    return <div className={styles.emptyState}>No upcoming cycles returned.</div>;
  }

  const openCycle =
    openIndex !== null
      ? contract.upcomingBillingCycles.find((c) => c.cycleIndex === openIndex)
      : null;

  const handleSave = () => {
    formRef.current?.requestSubmit();
    setOpenIndex(null);
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Cycle</th>
            <th scope="col">Expected billing</th>
            <th scope="col">Status</th>
            <th scope="col">Recent attempt</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {contract.upcomingBillingCycles.map((cycle) => {
            const editable = cycle.status === "UNBILLED" && !cycle.skipped;
            return (
              <tr key={cycle.cycleIndex}>
                <td>#{cycle.cycleIndex}</td>
                <td>{formatDateTime(cycle.billingAttemptExpectedDate)}</td>
                <td>
                  <span className={styles.badge}>
                    {cycle.skipped ? "SKIPPED" : cycle.status}
                    {cycle.edited ? " · EDITED" : ""}
                  </span>
                </td>
                <td>{cycle.billingAttempts[0]?.status ?? "No attempt"}</td>
                <td>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={!editable}
                    onClick={() => setOpenIndex(cycle.cycleIndex)}
                  >
                    Edit date
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal
        id={CYCLE_MODAL_ID}
        open={openCycle !== null && openCycle !== undefined}
        onHide={() => setOpenIndex(null)}
      >
        {openCycle ? (
          <Form
            ref={formRef}
            method="post"
            className={styles.modalForm}
            onSubmit={() => setOpenIndex(null)}
          >
            <input type="hidden" name="intent" value="change-cycle-date" />
            <input type="hidden" name="contractId" value={contract.id} />
            <input
              type="hidden"
              name="cycleIndex"
              value={openCycle.cycleIndex}
            />
            <p className={styles.muted}>
              Window: {formatDateTime(openCycle.cycleStartAt)} –{" "}
              {formatDateTime(openCycle.cycleEndAt)}
            </p>
            <label className={styles.field}>
              <span>Billing date</span>
              <input
                type="datetime-local"
                name="billingDate"
                required
                defaultValue={toLocalInputValue(
                  openCycle.billingAttemptExpectedDate,
                )}
                min={toLocalInputValue(openCycle.cycleStartAt) || undefined}
                max={toLocalInputValue(openCycle.cycleEndAt) || undefined}
              />
            </label>
          </Form>
        ) : null}
        <TitleBar
          title={
            openCycle
              ? `Edit billing date — cycle #${openCycle.cycleIndex}`
              : "Edit billing date"
          }
        >
          <button onClick={() => setOpenIndex(null)}>Cancel</button>
          <button variant="primary" onClick={handleSave}>
            Save date
          </button>
        </TitleBar>
      </Modal>
    </div>
  );
}

export default function SubscriptionAdminConsole() {
  const {
    query,
    contracts,
    selectedContract,
    subscriptionError,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: actionData.status === "error",
      });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Subscription admin">
      <s-section heading="Find subscriptions">
        <Form method="get" className={styles.searchForm}>
          <label className={styles.searchField}>
            <span>Search</span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Name, email, phone, customer ID, or contract ID"
            />
          </label>
          <button type="submit" className={styles.button}>
            Search
          </button>
        </Form>

        {actionData ? (
          <div
            className={
              actionData.status === "success"
                ? styles.successBox
                : styles.errorBox
            }
          >
            {actionData.message}
          </div>
        ) : null}

        {subscriptionError ? (
          <div className={styles.errorBox}>{subscriptionError}</div>
        ) : (
          <SearchResults
            contracts={contracts}
            query={query}
            selectedContract={selectedContract}
          />
        )}
      </s-section>

      <s-section heading="Contract detail">
        {selectedContract ? (
          <div className={styles.stack}>
            <ContractSummary contract={selectedContract} />
            <ScheduleActions contract={selectedContract} />
            <EditProductsModal
              contract={selectedContract}
              actionData={actionData ?? undefined}
            />
            <BillingCycles contract={selectedContract} />
          </div>
        ) : (
          <div className={styles.emptyState}>
            Select a subscription contract to manage it.
          </div>
        )}
      </s-section>

      {isSubmitting ? (
        <s-section slot="aside" heading="Status">
          <div className={styles.muted}>Submitting Shopify admin action...</div>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
