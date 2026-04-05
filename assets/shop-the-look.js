if (!customElements.get('shop-the-look')) {
  customElements.define(
    'shop-the-look',
    class ShopTheLook extends HTMLElement {
      constructor() {
        super();
        this.dots = this.querySelectorAll('.shop-the-look__dot');
        this.productCards = this.querySelectorAll('.shop-the-look__product-card');
        this.productList = this.querySelector('.shop-the-look__product-list');
        this.activeIndex = null;
        this.scrollObserver = null;
      }

      connectedCallback() {
        this.dots.forEach((dot) => {
          dot.addEventListener('click', this.onDotClick.bind(this));
        });

        this.productCards.forEach((card) => {
          card.addEventListener('click', this.onCardClick.bind(this));
        });

        if (this.productList && this.productCards.length > 0) {
          this.setupScrollObserver();
        }
      }

      disconnectedCallback() {
        if (this.scrollObserver) {
          this.scrollObserver.disconnect();
        }
      }

      onDotClick(event) {
        const index = parseInt(event.currentTarget.dataset.blockIndex, 10);
        this.setActive(index);
        this.scrollToProduct(index);
      }

      onCardClick(event) {
        const card = event.currentTarget;
        const index = parseInt(card.dataset.blockIndex, 10);
        this.setActive(index);
      }

      setActive(index) {
        this.dots.forEach((dot) => {
          const isActive = parseInt(dot.dataset.blockIndex, 10) === index;
          dot.classList.toggle('shop-the-look__dot--active', isActive);
          dot.setAttribute('aria-current', isActive ? 'true' : 'false');
        });

        this.productCards.forEach((card) => {
          const isActive = parseInt(card.dataset.blockIndex, 10) === index;
          card.classList.toggle('shop-the-look__product-card--active', isActive);
        });

        this.activeIndex = index;
      }

      scrollToProduct(index) {
        const card = this.querySelector(
          `.shop-the-look__product-card[data-block-index="${index}"]`
        );
        if (!card || !this.productList) return;

        card.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest',
        });
      }

      setupScrollObserver() {
        this.scrollObserver = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
                const index = parseInt(entry.target.dataset.blockIndex, 10);
                if (index !== this.activeIndex) {
                  this.setActive(index);
                }
              }
            }
          },
          {
            root: this.productList,
            threshold: 0.6,
          }
        );

        this.productCards.forEach((card) => this.scrollObserver.observe(card));
      }
    }
  );
}
