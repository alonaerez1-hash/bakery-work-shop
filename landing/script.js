const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');

if (menuToggle && header) {
  menuToggle.addEventListener('click', () => {
    const isOpen = header.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.textContent = isOpen ? '✕' : '☰';
  });

  header.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      header.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.textContent = '☰';
    });
  });
}

const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

reveals.forEach(el => observer.observe(el));

// Show above-the-fold content immediately, even if IntersectionObserver is delayed.
document.querySelectorAll('.hero .reveal').forEach(el => {
  requestAnimationFrame(() => el.classList.add('visible'));
});
