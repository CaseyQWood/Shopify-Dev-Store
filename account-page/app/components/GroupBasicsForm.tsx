import { Form } from "react-router";
import styles from "../styles/subscription-admin.module.css";

export function GroupBasicsForm({
  groupId,
  name,
  description,
  merchantCode,
}: {
  groupId: string;
  name: string;
  description: string | null | undefined;
  merchantCode: string;
}) {
  return (
    <Form method="post" className={styles.stack}>
      <input type="hidden" name="intent" value="update-group-basics" />
      <input type="hidden" name="groupId" value={groupId} />
      <div className={styles.field}>
        <span>Name *</span>
        <input type="text" name="name" required defaultValue={name} />
      </div>
      <div className={styles.field}>
        <span>Description</span>
        <textarea name="description" defaultValue={description ?? ""} />
      </div>
      <div className={styles.muted} style={{ fontSize: "0.82rem" }}>
        Merchant code: <code>{merchantCode}</code>
      </div>
      <button type="submit" className={styles.button}>
        Save details
      </button>
    </Form>
  );
}
