if (!customElements.get('shop-the-look')) {
  customElements.define(
    'shop-the-look',
    class ShopTheLook extends HTMLElement {
      constructor() {
        super();
        this.dots = this.querySelectorAll('.shop-the-look__dot');
        this.productCards = this.querySelectorAll('.shop-the-look__product-card');
        this.productList = this.querySelector('.shop-the-look__product-list');
        this.prevButton = this.querySelector('button[name="previous"]');
        this.nextButton = this.querySelector('button[name="next"]');
        this.currentPageEl = this.querySelector('.slider-counter--current');
        this.totalPageEl = this.querySelector('.slider-counter--total');
        this.activeIndex = null;
        this.scrollObserver = null;
        this.currentPage = 1;
      }

      connectedCallback() {
        this.dots.forEach((dot) => {
          dot.addEventListener('click', this.onDotClick.bind(this));
        });

        this.productCards.forEach((card) => {
          card.addEventListener('click', this.onCardClick.bind(this));
        });

        if (this.prevButton) {
          this.prevButton.addEventListener('click', this.onPrevClick.bind(this));
        }

        if (this.nextButton) {
          this.nextButton.addEventListener('click', this.onNextClick.bind(this));
        }

        if (this.productList && this.productCards.length > 0) {
          this.productList.addEventListener('scroll', this.onScroll.bind(this));
          this.setupScrollObserver();
          this.updateButtons();
        }
      }

      disconnectedCallback() {
        if (this.scrollObserver) {
          this.scrollObserver.disconnect();
        }
      }

      get isVertical() {
        return window.matchMedia('(min-width: 750px)').matches;
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

      onPrevClick(event) {
        event.preventDefault();
        const target = Math.max(0, this.currentPage - 2);
        this.scrollToProduct(target);
      }

      onNextClick(event) {
        event.preventDefault();
        const target = Math.min(this.productCards.length - 1, this.currentPage);
        this.scrollToProduct(target);
      }

      onScroll() {
        if (this._scrollTimeout) cancelAnimationFrame(this._scrollTimeout);
        this._scrollTimeout = requestAnimationFrame(() => {
          this.updateCurrentPage();
          this.updateButtons();
        });
      }

      updateCurrentPage() {
        if (!this.productList || this.productCards.length === 0) return;

        const vertical = this.isVertical;
        const scrollPos = vertical ? this.productList.scrollTop : this.productList.scrollLeft;

        let closest = 0;
        let closestDist = Infinity;

        this.productCards.forEach((card, i) => {
          const offset = vertical ? card.offsetTop : card.offsetLeft;
          const dist = Math.abs(offset - scrollPos);
          if (dist < closestDist) {
            closestDist = dist;
            closest = i;
          }
        });

        this.currentPage = closest + 1;
        if (this.currentPageEl) {
          this.currentPageEl.textContent = this.currentPage;
        }
      }

      updateButtons() {
        if (!this.productList || !this.prevButton || !this.nextButton) return;

        const vertical = this.isVertical;
        const scrollPos = vertical ? this.productList.scrollTop : this.productList.scrollLeft;
        const scrollSize = vertical
          ? this.productList.scrollHeight - this.productList.clientHeight
          : this.productList.scrollWidth - this.productList.clientWidth;

        if (scrollPos <= 1) {
          this.prevButton.setAttribute('disabled', 'disabled');
        } else {
          this.prevButton.removeAttribute('disabled');
        }

        if (scrollPos >= scrollSize - 1) {
          this.nextButton.setAttribute('disabled', 'disabled');
        } else {
          this.nextButton.removeAttribute('disabled');
        }
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
        const card = this.productCards[index];
        if (!card || !this.productList) return;

        const vertical = this.isVertical;

        if (vertical) {
          this.productList.scrollTo({
            top: card.offsetTop - this.productList.offsetTop,
            behavior: 'smooth',
          });
        } else {
          this.productList.scrollTo({
            left: card.offsetLeft - this.productList.offsetLeft,
            behavior: 'smooth',
          });
        }
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
