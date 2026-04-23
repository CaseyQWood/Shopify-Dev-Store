import { useLoaderData } from "react-router";

import { getMockAddresses, getMockUser } from "../account-page-proxy/mock";
import styles from "./styles.module.css";

export const loader = async () => {
  return {
    user: getMockUser(),
    addresses: getMockAddresses(),
  };
};

export default function AccountDetailsTab() {
  const { user, addresses } = useLoaderData<typeof loader>();

  return (
    <section aria-labelledby="details-heading">
      <h2 id="details-heading" className={styles.heading}>
        Account details
      </h2>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Profile</h3>
          <button type="button" className={styles.button} disabled>
            Edit profile
          </button>
        </div>
        <div className={styles.fieldGrid}>
          <div>
            <p className={styles.fieldLabel}>First name</p>
            <p className={styles.fieldValue}>{user.firstName}</p>
          </div>
          <div>
            <p className={styles.fieldLabel}>Last name</p>
            <p className={styles.fieldValue}>{user.lastName}</p>
          </div>
          <div>
            <p className={styles.fieldLabel}>Email</p>
            <p className={styles.fieldValue}>{user.email}</p>
          </div>
          <div>
            <p className={styles.fieldLabel}>Phone</p>
            <p className={styles.fieldValue}>{user.phone}</p>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Addresses</h3>
          <button type="button" className={styles.button} disabled>
            Add address
          </button>
        </div>
        <ul className={styles.addressList}>
          {addresses.map((address) => (
            <li key={address.id} className={styles.addressCard}>
              {address.isDefault ? (
                <span className={styles.defaultTag}>Default</span>
              ) : null}
              <address className={styles.addressBody}>
                {address.name}
                <br />
                {address.line1}
                {address.line2 ? (
                  <>
                    <br />
                    {address.line2}
                  </>
                ) : null}
                <br />
                {address.city}, {address.region} {address.postalCode}
                <br />
                {address.country}
              </address>
              <div className={styles.actions}>
                <button type="button" className={styles.button} disabled>
                  Edit
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonDanger}`}
                  disabled
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
