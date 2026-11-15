(() => {
  const characters = [
    {
      id: "character-01-vpose",
      name: "브이 포즈 스튜디오 초상화",
      dims: "2052 × 1536 SBS · 63 MB PLY",
      sbsSrc: "./assets/media/character-01-vpose.sbs.webp",
      thumbSrc: "./assets/media/character-01-vpose.left.webp",
      caption: "단일 초상화에서 손가락 포즈와 배경 공간감을 분리해 낸 양안 SBS 및 2D 모노 궤적 기준 모델입니다."
    },
    {
      id: "character-03-studio-a",
      name: "스튜디오 인물 A",
      dims: "2172 × 1448 SBS · 63 MB PLY",
      sbsSrc: "./assets/media/character-03-studio-a.sbs.webp",
      thumbSrc: "./assets/media/character-03-studio-a.left.webp",
      caption: "인물 전경과 배경 사이의 깊이 분리를 좌·우 시차 슬라이더 또는 Wiggle 3D로 확인할 수 있습니다."
    },
    {
      id: "character-04-studio-b",
      name: "스튜디오 인물 B",
      dims: "3072 × 2752 SBS · 63 MB PLY",
      sbsSrc: "./assets/media/character-04-studio-b.sbs.webp",
      thumbSrc: "./assets/media/character-04-studio-b.left.webp",
      caption: "고해상도 입력 이미지의 미세 디테일까지 유지하며 양안 시차를 생성한 결과입니다."
    },
    {
      id: "character-05-studio-c",
      name: "스튜디오 인물 C",
      dims: "3584 × 2400 SBS · 63 MB PLY",
      sbsSrc: "./assets/media/character-05-studio-c.sbs.webp",
      thumbSrc: "./assets/media/character-05-studio-c.left.webp",
      caption: "와이드 프레이밍에서도 가장자리 뭉개짐 없이 입체감을 구현한 SBS 출력입니다."
    }
  ];

  // Showcase Tabs
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.getAttribute("aria-controls");
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      panels.forEach((p) => {
        p.classList.toggle("panel-hidden", p.id !== targetId);
      });
    });
  });

  // SBS Viewer State
  const charListEl = document.getElementById("char-list");
  const modeButtons = Array.from(document.querySelectorAll("#sbs-modes .mode-pill"));
  const canvas = document.getElementById("sbs-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const splitControl = document.getElementById("split-control");
  const splitRange = document.getElementById("split-range");
  const splitValue = document.getElementById("split-value");
  const captionEl = document.getElementById("sbs-caption");

  let activeChar = characters[0];
  let activeMode = "sbs";
  let wiggleTimer = null;
  let wiggleEye = "left";
  let loadedImg = null;
  const imageCache = new Map();

  function renderCharButtons() {
    charListEl.innerHTML = "";
    characters.forEach((ch) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "char-btn";
      btn.setAttribute("aria-pressed", String(ch.id === activeChar.id));
      btn.innerHTML = `
        <img class="char-thumb" src="${ch.thumbSrc}" alt="${ch.name}" loading="lazy" />
        <span class="char-meta">
          <span class="char-name">${ch.name}</span>
          <span class="char-sub">${ch.dims}</span>
        </span>
      `;
      btn.addEventListener("click", () => {
        activeChar = ch;
        renderCharButtons();
        loadAndDraw();
      });
      charListEl.appendChild(btn);
    });
  }

  function stopWiggle() {
    if (wiggleTimer) {
      window.clearInterval(wiggleTimer);
      wiggleTimer = null;
    }
  }

  function drawFrame() {
    if (!loadedImg || !ctx) return;
    const w = loadedImg.naturalWidth;
    const h = loadedImg.naturalHeight;
    const halfW = Math.floor(w / 2);

    if (activeMode === "sbs") {
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(loadedImg, 0, 0);
      return;
    }

    canvas.width = halfW;
    canvas.height = h;

    if (activeMode === "wiggle") {
      const sx = wiggleEye === "left" ? 0 : halfW;
      ctx.drawImage(loadedImg, sx, 0, halfW, h, 0, 0, halfW, h);
      return;
    }

    if (activeMode === "split") {
      const pct = Number(splitRange.value) / 100;
      const splitX = Math.round(halfW * pct);
      // Left eye on left side, Right eye on right side
      ctx.drawImage(loadedImg, halfW, 0, halfW, h, 0, 0, halfW, h);
      if (splitX > 0) {
        ctx.drawImage(loadedImg, 0, 0, splitX, h, 0, 0, splitX, h);
      }
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = Math.max(2, Math.round(halfW / 320));
      ctx.beginPath();
      ctx.moveTo(splitX, 0);
      ctx.lineTo(splitX, h);
      ctx.stroke();
      return;
    }

    if (activeMode === "anaglyph") {
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d", { willReadFrequently: true });
      octx.drawImage(loadedImg, 0, 0);
      const leftData = octx.getImageData(0, 0, halfW, h);
      const rightData = octx.getImageData(halfW, 0, halfW, h);
      const out = ctx.createImageData(halfW, h);
      const ld = leftData.data;
      const rd = rightData.data;
      const od = out.data;

      for (let i = 0; i < od.length; i += 4) {
        od[i] = ld[i];         // Red from Left eye
        od[i + 1] = rd[i + 1]; // Green from Right eye
        od[i + 2] = rd[i + 2]; // Blue from Right eye
        od[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
    }
  }

  function loadAndDraw() {
    captionEl.textContent = activeChar.caption;
    splitControl.hidden = activeMode !== "split";
    stopWiggle();

    const startModeLoop = () => {
      drawFrame();
      if (activeMode === "wiggle") {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced) {
          wiggleTimer = window.setInterval(() => {
            wiggleEye = wiggleEye === "left" ? "right" : "left";
            drawFrame();
          }, 180);
        }
      }
    };

    if (imageCache.has(activeChar.sbsSrc)) {
      loadedImg = imageCache.get(activeChar.sbsSrc);
      startModeLoop();
      return;
    }

    const img = new Image();
    img.onload = () => {
      imageCache.set(activeChar.sbsSrc, img);
      if (activeChar.sbsSrc === img.getAttribute("data-src")) {
        loadedImg = img;
        startModeLoop();
      }
    };
    img.setAttribute("data-src", activeChar.sbsSrc);
    img.src = activeChar.sbsSrc;
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeMode = btn.dataset.mode;
      modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      loadAndDraw();
    });
  });

  splitRange.addEventListener("input", () => {
    splitValue.textContent = `${splitRange.value}%`;
    if (activeMode === "split") {
      drawFrame();
    }
  });

  // Copy git clone command
  const copyBtn = document.getElementById("copy-clone-btn");
  const cloneCmd = document.getElementById("clone-cmd");
  if (copyBtn && cloneCmd) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(cloneCmd.textContent.trim());
        copyBtn.textContent = "복사됨!";
        window.setTimeout(() => {
          copyBtn.textContent = "복사";
        }, 1800);
      } catch {
        copyBtn.textContent = "직접 복사";
      }
    });
  }

  renderCharButtons();
  loadAndDraw();
})();
