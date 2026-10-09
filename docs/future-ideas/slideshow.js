const slide = document.getElementById("slide");
const grid = document.getElementById("grid");
const counter = document.getElementById("counter");
let index = Math.max(
  0,
  Math.min(ideas.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1),
);

function show(i) {
  index = (i + ideas.length) % ideas.length;
  slide.innerHTML = renderWindow(ideas[index], index);
  counter.textContent = `${index + 1} / ${ideas.length}`;
  history.replaceState(null, "", `#${index + 1}`);
}

function buildGrid() {
  grid.innerHTML = ideas
    .map(
      (idea, i) =>
        `<div class="thumb" data-i="${i}">${renderWindow(idea, i)}<span class="num">${i + 1}</span></div>`,
    )
    .join("");
  grid.querySelectorAll(".thumb").forEach((el) => {
    el.addEventListener("click", () => {
      document.body.classList.remove("overview");
      show(parseInt(el.dataset.i, 10));
    });
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown")
    show(index + 1);
  else if (e.key === "ArrowLeft" || e.key === "PageUp") show(index - 1);
  else if (e.key === "Home") show(0);
  else if (e.key === "End") show(ideas.length - 1);
  else if (e.key.toLowerCase() === "g")
    document.body.classList.toggle("overview");
  else if (e.key.toLowerCase() === "f") {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }
});

slide.addEventListener("click", (e) => {
  const rect = slide.getBoundingClientRect();
  show(e.clientX - rect.left < rect.width / 2 ? index - 1 : index + 1);
});

buildGrid();
show(index);
