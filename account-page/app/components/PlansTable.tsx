import { Form } from "react-router";
import type { SellingPlanGroupDetail } from "../subscriptions/selling-plans.server";
import styles from "../styles/subscription-admin.module.css";

type Plan = SellingPlanGroupDetail["sellingPlans"]["nodes"][0];

function PlanRow({ groupId, plan }: { groupId: string; plan: Plan }) {
  const interval = plan.billingPolicy?.interval ?? "MONTH";
  const intervalCount = plan.billingPolicy?.intervalCount ?? 1;

  return (
    <Form method="post" style={{ display: "contents" }}>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="planId" value={plan.id} />
      <tr>
        <td>
          <input
            type="text"
            name="name"
            required
            defaultValue={plan.name}
            className={styles.cellInput}
          />
        </td>
        <td>
          <select
            name="interval"
            defaultValue={interval}
            className={styles.cellSelect}
          >
            <option value="WEEK">WEEK</option>
            <option value="MONTH">MONTH</option>
          </select>
        </td>
        <td>
          <input
            type="number"
            name="intervalCount"
            min={1}
            required
            defaultValue={intervalCount}
            className={styles.cellNumber}
          />
        </td>
        <td className={styles.planActions}>
          <button
            type="submit"
            name="intent"
            value="update-plan"
            className={styles.button}
          >
            Save
          </button>
          <button
            type="submit"
            name="intent"
            value="remove-plan"
            className={styles.dangerButton}
            formNoValidate
            aria-label={`Remove plan ${plan.name}`}
          >
            Remove
          </button>
        </td>
      </tr>
    </Form>
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
        <div className={styles.tableWrap}>
          <table className={styles.plansGrid}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Interval</th>
                <th scope="col">Every</th>
                <th scope="col" className={styles.planActions}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <PlanRow key={plan.id} groupId={groupId} plan={plan} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddPlanForm groupId={groupId} />
    </div>
  );
}
