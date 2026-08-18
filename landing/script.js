const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav-links');
const currentPage = document.body?.dataset?.page || 'home';

const navigation = [
  { key: 'how', href: 'how-it-works.html', label: 'How it works' },
  { key: 'features', href: 'features.html', label: 'Features' },
  { key: 'bakers', href: 'for-bakers.html', label: 'For bakers' },
  { key: 'calculator', href: 'calculator.html', label: 'Free calculator' },
  { key: 'pricing', href: 'pricing.html', label: 'Pricing' }
];

if (nav) {
  nav.innerHTML = navigation.map(item =>
    `<a href="${item.href}"${currentPage === item.key ? ' class="active" aria-current="page"' : ''}>${item.label}</a>`
  ).join('');
}

// The marketing site is deployed as the Pages root while the untouched app is
// published into /app/ by the deployment workflow. Fix legacy landing links at runtime.
document.querySelectorAll('a[href="../index.html"]').forEach(link => {
  link.setAttribute('href', 'app/');
});

document.querySelectorAll('.brand[href="#top"]').forEach(link => {
  link.setAttribute('href', 'index.html');
});

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

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  reveals.forEach(el => observer.observe(el));
} else {
  reveals.forEach(el => el.classList.add('visible'));
}

// Show above-the-fold content immediately, even if IntersectionObserver is delayed.
document.querySelectorAll('.hero .reveal, .page-hero .reveal').forEach(el => {
  requestAnimationFrame(() => el.classList.add('visible'));
});
