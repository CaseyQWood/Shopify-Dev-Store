import { Form } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { SellingPlanGroupDetail } from "../subscriptions/selling-plans.server";
import styles from "../styles/subscription-admin.module.css";

type Product = SellingPlanGroupDetail["products"]["nodes"][0];

const imgStyle = { width: 56, height: 56, objectFit: "cover", borderRadius: 4, flexShrink: 0 } as const;
const placeholderStyle = { width: 56, height: 56, background: "#f0f0f0", borderRadius: 4, flexShrink: 0 } as const;

function ProductImage({ product }: { product: Product }) {
  return product.featuredImage ? (
    <img src={product.featuredImage.url} alt={product.featuredImage.altText ?? ""} style={imgStyle} />
  ) : (
    <div style={placeholderStyle} />
  );
}

function formatPriceRange(
  priceRange: SellingPlanGroupDetail["products"]["nodes"][number]["priceRangeV2"],
): string {
  const { minVariantPrice, maxVariantPrice } = priceRange;
  const fmt = (amount: string, currencyCode: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(
      parseFloat(amount),
    );

  if (minVariantPrice.amount === maxVariantPrice.amount) {
    return fmt(minVariantPrice.amount, minVariantPrice.currencyCode);
  }
  return `${fmt(minVariantPrice.amount, minVariantPrice.currencyCode)} – ${fmt(maxVariantPrice.amount, maxVariantPrice.currencyCode)}`;
}

function ProductCard({ product, groupId }: { product: Product; groupId: string }) {
  return (
    <div className={styles.productCard}>
      <ProductImage product={product} />
      <div className={styles.productCardBody}>
        <div className={styles.productCardTitle}>{product.title}</div>
        <div className={`${styles.muted} ${styles.productCardPrice}`}>
          {formatPriceRange(product.priceRangeV2)}
        </div>
      </div>
      <Form method="post" className={styles.productCardRemoveForm}>
        <input type="hidden" name="intent" value="remove-product" />
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="productId" value={product.id} />
        <button
          type="submit"
          className={styles.iconRemove}
          aria-label={`Remove ${product.title}`}
          title={`Remove ${product.title}`}
        >
          ×
        </button>
      </Form>
    </div>
  );
}

function submitAddProductsForm(groupId: string, productIds: string[]) {
  const form = document.createElement("form");
  form.method = "post";
  form.style.display = "none";
  form.appendChild(Object.assign(document.createElement("input"), { name: "intent", value: "add-products" }));
  form.appendChild(Object.assign(document.createElement("input"), { name: "groupId", value: groupId }));
  form.appendChild(Object.assign(document.createElement("input"), { name: "productIdsInput", value: productIds.join("\n") }));
  document.body.appendChild(form);
  form.submit();
}

function AddProductsButton({
  groupId,
  products,
}: {
  groupId: string;
  products: SellingPlanGroupDetail["products"]["nodes"];
}) {
  const shopify = useAppBridge();

  async function openAddProductsPicker() {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (selection?.length) {
      submitAddProductsForm(groupId, selection.map((p) => p.id));
    }
  }

  return (
    <button
      type="button"
      className={styles.pickerButton}
      style={{ marginTop: 12 }}
      onClick={openAddProductsPicker}
    >
      + Add products
    </button>
  );
}

export function ProductCardList({
  groupId,
  products,
}: {
  groupId: string;
  products: SellingPlanGroupDetail["products"]["nodes"];
}) {
  return (
    <div>
      <h3 style={{ margin: "16px 0 8px" }}>Attached products</h3>
      {products.length === 0 ? (
        <div className={styles.emptyState}>No products attached.</div>
      ) : (
        <div className={styles.productGrid}>
          {products.map((product) => (
            <ProductCard key={product.id} product={product} groupId={groupId} />
          ))}
        </div>
      )}
      <AddProductsButton groupId={groupId} products={products} />
    </div>
  );
}
