import { Form } from "react-router";
import type { SellingPlanGroupDetail } from "../subscriptions/selling-plans.server";
import styles from "../styles/subscription-admin.module.css";

type Plan = SellingPlanGroupDetail["sellingPlans"]["nodes"][0];

function PlanUpdateRow({ plan }: { plan: Plan }) {
  const interval = plan.billingPolicy?.interval ?? "MONTH";
  const intervalCount = plan.billingPolicy?.intervalCount ?? 1;

  return (
    <tr>
      <td style={{ padding: "6px 8px" }}>
        <input
          type="text"
          name="name"
          required
          defaultValue={plan.name}
          style={{ width: "100%" }}
        />
      </td>
      <td style={{ padding: "6px 8px" }}>
        <select name="interval" defaultValue={interval} style={{ minHeight: 32 }}>
          <option value="WEEK">WEEK</option>
          <option value="MONTH">MONTH</option>
        </select>
      </td>
      <td style={{ padding: "6px 8px" }}>
        <input
          type="number"
          name="intervalCount"
          min={1}
          required
          defaultValue={intervalCount}
          style={{ width: 70 }}
        />
      </td>
      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
        <button type="submit" className={styles.button}>
          Save
        </button>
      </td>
    </tr>
  );
}

function PlanUpdateForm({ groupId, plan }: { groupId: string; plan: Plan }) {
  return (
    <Form method="post" style={{ display: "contents" }}>
      <input type="hidden" name="intent" value="update-plan" />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="planId" value={plan.id} />
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <PlanUpdateRow plan={plan} />
        </tbody>
      </table>
    </Form>
  );
}

function PlanRemoveForm({ groupId, plan }: { groupId: string; plan: Plan }) {
  return (
    <Form method="post" style={{ display: "inline" }}>
      <input type="hidden" name="intent" value="remove-plan" />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="planId" value={plan.id} />
      <button
        type="submit"
        className={styles.chipRemove}
        style={{ marginLeft: 8 }}
        aria-label={`Remove plan ${plan.name}`}
      >
        Remove
      </button>
    </Form>
  );
}

function PlanRow({ groupId, plan }: { groupId: string; plan: Plan }) {
  return (
    <tr>
      <td colSpan={4} style={{ padding: 0 }}>
        <PlanUpdateForm groupId={groupId} plan={plan} />
        <PlanRemoveForm groupId={groupId} plan={plan} />
      </td>
    </tr>
  );
}

function AddPlanForm({ groupId }: { groupId: string }) {
  return (
    <Form method="post" className={styles.stack} style={{ marginTop: 12 }}>
      <input type="hidden" name="intent" value="add-plan" />
      <input type="hidden" name="groupId" value={groupId} />
      <h4 style={{ margin: "8px 0 4px" }}>Add plan</h4>
      <div className={styles.field}>
        <span>Name *</span>
        <input type="text" name="name" required placeholder="e.g. Quarterly" />
      </div>
      <div className={styles.field}>
        <span>Interval *</span>
        <select name="interval" defaultValue="MONTH" style={{ minHeight: 32 }}>
          <option value="WEEK">WEEK</option>
          <option value="MONTH">MONTH</option>
        </select>
      </div>
      <div className={styles.field}>
        <span>Every *</span>
        <input type="number" name="intervalCount" min={1} required defaultValue={1} style={{ width: 80 }} />
      </div>
      <button type="submit" className={styles.button}>
        Add plan
      </button>
    </Form>
  );
}

export function PlansTable({
  groupId,
  plans,
}: {
  groupId: string;
  plans: SellingPlanGroupDetail["sellingPlans"]["nodes"];
}) {
  return (
    <div className={styles.plansTable}>
      <h3 style={{ margin: "16px 0 8px" }}>Selling plans</h3>
      {plans.length === 0 ? (
        <div className={styles.emptyState}>No plans yet.</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Interval</th>
              <th scope="col">Every</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <PlanRow key={plan.id} groupId={groupId} plan={plan} />
            ))}
          </tbody>
        </table>
      )}
      <AddPlanForm groupId={groupId} />
    </div>
  );
}
