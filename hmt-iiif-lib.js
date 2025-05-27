// hmt-iiif-lib.js
(function(window) {
    'use strict';

    const IIIF_SERVER_PROTOCOL = 'http';
    const IIIF_SERVER_HOST = 'www.homermultitext.org';
    const IIIF_SERVER_PATH = '/iipsrv?IIIF=';
    const HMT_IIIF_PREFIX_BASE = '/project/homer/pyramidal/deepzoom';

    // --- Helper: Parse URN ---
    function parseURN(urnStr) {
        if (typeof urnStr !== 'string') {
            return { valid: false, error: "URN must be a string." };
        }

        const parts = urnStr.split('@');
        const baseUrn = parts[0];
        let roi = null;

        if (parts.length > 2) {
            return { valid: false, error: "Invalid URN format: multiple '@' symbols." };
        }

        if (parts.length === 2 && parts[1]) {
            const roiParts = parts[1].split(',');
            if (roiParts.length === 4) {
                const [x, y, w, h] = roiParts.map(parseFloat);
                if ([x, y, w, h].every(val => !isNaN(val) && val >= 0 && val <= 1)) {
                    roi = { x, y, w, h };
                } else {
                    return { valid: false, error: "Invalid ROI format: values must be numbers between 0 and 1." };
                }
            } else {
                return { valid: false, error: "Invalid ROI format: must be x,y,w,h." };
            }
        }

        const citeParts = baseUrn.split(':');
        if (citeParts.length !== 5 || citeParts[0] !== 'urn' || citeParts[1] !== 'cite2') {
            return { valid: false, error: "Invalid CITE2 URN structure." };
        }

        const namespace = citeParts[2];
        const collectionComponent = citeParts[3];
        const objectId = citeParts[4];

        const collectionParts = collectionComponent.split('.');
        if (collectionParts.length !== 2) {
            return { valid: false, error: "Invalid URN collection component format." };
        }

        return {
            valid: true,
            baseUrn: baseUrn,
            fullUrn: urnStr,
            namespace: namespace,
            collectionParts: collectionParts,
            objectId: objectId,
            roi: roi,
            error: null
        };
    }

    // --- Helper: Random Color ---
    function getRandomColor() {
        const r = Math.floor(Math.random() * 200); // Keep it a bit dark for visibility
        const g = Math.floor(Math.random() * 200);
        const b = Math.floor(Math.random() * 200);
        return `rgba(${r},${g},${b},0.5)`; // Semi-transparent
    }

    // --- Helper: Debounce ---
    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    }

    // --- getIIIFImageUrl Function ---
    function getIIIFImageUrl(urnStr, options = {}) {
        const parsed = parseURN(urnStr);
        if (!parsed.valid) {
            console.error("getIIIFImageUrl Error:", parsed.error);
            return null;
        }

        const iiifPrefix = `${HMT_IIIF_PREFIX_BASE}/${parsed.namespace}/${parsed.collectionParts[0]}/${parsed.collectionParts[1]}`;
        const imageIdentifier = `${parsed.objectId}.tif`;

        const baseUrl = `${IIIF_SERVER_PROTOCOL}://${IIIF_SERVER_HOST}${IIIF_SERVER_PATH}${iiifPrefix}/${imageIdentifier}`;

        let region = 'full';
        if (parsed.roi) {
            region = `pct:${parsed.roi.x * 100},${parsed.roi.y * 100},${parsed.roi.w * 100},${parsed.roi.h * 100}`;
        }

        let size = 'full';
        if (options.width && options.height) {
            size = `!${options.width},${options.height}`;
        } else if (options.width) {
            size = `${options.width},`;
        } else if (options.height) {
            size = `,${options.height}`;
        }

        const rotation = '0';
        const quality = 'default';
        const format = 'jpg';

        return `${baseUrl}/${region}/${size}/${rotation}/${quality}.${format}`;
    }

    // --- createViewer Function ---
    function createViewer(containerIdOrElement, urnOrUrns, viewerOptions = {}) {
        const container = typeof containerIdOrElement === 'string' ? document.getElementById(containerIdOrElement) : containerIdOrElement;
        if (!container) {
            console.error("Viewer container not found.");
            return null;
        }
        container.innerHTML = ''; // Clear previous content

        const canvas = document.createElement('canvas');
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        // canvas.style.border = "1px solid #ccc"; // Style from test HTML, not library
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        let state = {
            baseParsedURN: null,
            originalWidth: 0,
            originalHeight: 0,
            currentZoom: 1.0, // Defines how many original image pixels are covered by one "logical" canvas pixel (before aspect ratio correction)
            viewCenterX_orig: 0, // Center of the viewport in original image coordinates
            viewCenterY_orig: 0,

            // Details of how the image is currently drawn on canvas (after aspect ratio correction)
            imgDrawDetails: { x: 0, y: 0, width: 0, height: 0 },

            loadedIIIFImage: null, // Will store { image: Image, requestedRegion: {x,y,w,h in orig coords} }
            highlightedROIs: [], // { urn, roi: {x,y,w,h in percentages}, color }
            isPanning: false,
            panStart_orig: { x: 0, y: 0 }, // Pan start in original image coordinates
            panStartViewCenter: { x: 0, y: 0 }, // viewCenterX_orig at pan start
            isSelecting: false,
            selectionStartCanvas: { x: 0, y: 0 }, // Mouse click in raw canvas coords
            currentSelectionRectCanvas: null, // {x,y,w,h} in raw canvas coords
            imageLoadError: null,
            isLoadingImage: false,
            options: {
                onRectangleSelected: viewerOptions.onRectangleSelected || function() {},
                onQuery: viewerOptions.onQuery || function() {},
                minZoomFactor: 0.01, // Factor relative to full image view, e.g. 0.1 means zoom out 10x
                maxZoomFactor: 20,  // Factor relative to 1:1 pixel mapping, e.g., 10 means 1 orig pixel = 10 canvas pixels
            },
            mouseOverCanvas: false,
            altKeyDown: false,
            shiftKeyDown: false,
        };

        const debouncedRequestImageAndRedraw = debounce(requestImageAndRedraw, 150);

        const observer = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                    if (state.originalWidth > 0) { // If image info is loaded
                        // Re-calculate initial zoom settings if it's the first time after getting originalW/H
                        // Or simply redraw with current view parameters
                        debouncedRequestImageAndRedraw();
                    }
                }
            }
        });
        observer.observe(canvas);
        
        // Set initial canvas resolution after it's in the DOM and sized by CSS
        // ResizeObserver should handle this, but as a fallback:
        requestAnimationFrame(() => {
            const rect = canvas.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== rect.height) {
                canvas.width = rect.width;
                canvas.height = rect.height;
            }
            // If URN was parsed but info not fetched (e.g., canvas was 0x0 initially)
            if (state.baseParsedURN && !state.originalWidth && canvas.width > 0 && canvas.height > 0) {
                fetchImageInfo();
            } else if (state.originalWidth) { // If info already available and canvas is sized
                debouncedRequestImageAndRedraw();
            }
        });

        function parseInitialUrns(inputUrns) {
            const initialRois = [];
            let baseUrnToUse = null;
            const urnArray = Array.isArray(inputUrns) ? inputUrns : [inputUrns];

            for (let i = 0; i < urnArray.length; i++) {
                const parsed = parseURN(urnArray[i]);
                if (!parsed.valid) {
                    console.error("Invalid URN provided for viewer:", parsed.error, urnArray[i]);
                    if (i === 0) {
                        state.imageLoadError = `Invalid base URN: ${parsed.error}`;
                        return false;
                    }
                    continue;
                }
                if (i === 0) {
                    state.baseParsedURN = parsed;
                    baseUrnToUse = parsed.baseUrn;
                } else if (parsed.baseUrn !== baseUrnToUse) {
                    console.warn("All URNs in array must share the same base image. Skipping:", urnArray[i]);
                    continue;
                }
                if (parsed.roi) {
                    if (!initialRois.some(r => r.urn === parsed.fullUrn)) {
                         initialRois.push({
                            urn: parsed.fullUrn,
                            roi: parsed.roi,
                            color: getRandomColor()
                        });
                    }
                }
            }
            state.highlightedROIs = initialRois;
            return state.baseParsedURN != null;
        }

        function fetchImageInfo() {
            if (!state.baseParsedURN) {
                state.imageLoadError = "Base URN not properly parsed.";
                redraw(); return;
            }
            if (canvas.width === 0 || canvas.height === 0) { // Defer if canvas not sized
                requestAnimationFrame(fetchImageInfo); return;
            }
            const infoUrl = `${IIIF_SERVER_PROTOCOL}://${IIIF_SERVER_HOST}${IIIF_SERVER_PATH}${HMT_IIIF_PREFIX_BASE}/${state.baseParsedURN.namespace}/${state.baseParsedURN.collectionParts[0]}/${state.baseParsedURN.collectionParts[1]}/${state.baseParsedURN.objectId}.tif/info.json`;

            fetch(infoUrl, { mode: 'cors' })
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return response.json();
                })
                .then(info => {
                    state.originalWidth = info.width;
                    state.originalHeight = info.height;
                    state.viewCenterX_orig = state.originalWidth / 2;
                    state.viewCenterY_orig = state.originalHeight / 2;

                    const scaleX = canvas.width / state.originalWidth;
                    const scaleY = canvas.height / state.originalHeight;
                    state.currentZoom = Math.min(scaleX, scaleY); // Initial zoom to fit whole image

                    // Adjust min/max zoom factors based on this initial fit and a nominal 1:1 pixel mapping
                    // minZoom allows zooming out further from this "fit" view.
                    state.options.minZoomFactor = state.currentZoom * 0.1;
                    // maxZoomFactor is relative to currentZoom where 1.0 = 1 canvas pixel shows 1 image pixel.
                    // If currentZoom is 0.5 (image twice as large as canvas), maxZoom of 10 means 20x currentZoom.
                    // This needs to be set relative to `state.currentZoom = 1` meaning 1:1.
                    // Let's define maxZoom as an absolute factor. E.g., 1 image pixel = N canvas pixels.
                    // MaxZoom = 10 means 1 original pixel can be magnified to 10 canvas pixels.
                    // state.currentZoom = canvas_pixels / original_pixels.
                    // So state.options.maxZoomFactor = 10 is fine as an upper limit for state.currentZoom.

                    requestImageAndRedraw();
                })
                .catch(error => {
                    console.error("Error fetching IIIF info.json:", error);
                    state.imageLoadError = `Failed to load image info: ${error.message}.`;
                    redraw();
                });
        }

        function requestImageAndRedraw() {
            if (!state.originalWidth || !state.originalHeight || state.isLoadingImage || canvas.width === 0 || canvas.height === 0) {
                if((canvas.width === 0 || canvas.height === 0) && state.originalWidth > 0 && !state.isLoadingImage) {
                    // Canvas not sized yet but image info is available, try again
                    state.isLoadingImage = true; // Prevent re-entrancy
                    requestAnimationFrame(() => {
                        state.isLoadingImage = false; // Reset flag
                        requestImageAndRedraw();
                    });
                }
                return;
            }
            state.isLoadingImage = true;
            state.imageLoadError = null;

            // Viewport dimensions in original image coordinates, based on canvas size and current zoom
            const viewPortWidth_orig = canvas.width / state.currentZoom;
            const viewPortHeight_orig = canvas.height / state.currentZoom;

            // Top-left of this ideal viewport
            let topLeftX_orig = state.viewCenterX_orig - viewPortWidth_orig / 2;
            let topLeftY_orig = state.viewCenterY_orig - viewPortHeight_orig / 2;

            // Clamp this viewport to the actual image boundaries to get the IIIF region
            const regionX = Math.max(0, Math.min(topLeftX_orig, state.originalWidth -1)); // ensure regionX is within image
            const regionY = Math.max(0, Math.min(topLeftY_orig, state.originalHeight -1));

            const regionEndX = Math.max(regionX + 1, Math.min(topLeftX_orig + viewPortWidth_orig, state.originalWidth));
            const regionEndY = Math.max(regionY + 1, Math.min(topLeftY_orig + viewPortHeight_orig, state.originalHeight));
            
            const regionW = Math.max(1, regionEndX - regionX);
            const regionH = Math.max(1, regionEndY - regionY);

            const iiifRegion = `${Math.round(regionX)},${Math.round(regionY)},${Math.round(regionW)},${Math.round(regionH)}`;
            const iiifSizeParam = `!${canvas.width},${canvas.height}`; // Best fit, preserves aspect ratio of the REGION

            const imageUrl = `${IIIF_SERVER_PROTOCOL}://${IIIF_SERVER_HOST}${IIIF_SERVER_PATH}` +
                             `${HMT_IIIF_PREFIX_BASE}/${state.baseParsedURN.namespace}/${state.baseParsedURN.collectionParts[0]}/${state.baseParsedURN.collectionParts[1]}/${state.baseParsedURN.objectId}.tif` +
                             `/${iiifRegion}/${iiifSizeParam}/0/default.jpg`;

            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                // Store the image and the details of the original image region it represents
                state.loadedIIIFImage = {
                    image: img,
                    requestedRegion: { x: regionX, y: regionY, w: regionW, h: regionH }
                };
                state.isLoadingImage = false;
                redraw();
            };
            img.onerror = (e) => {
                console.error("Error loading IIIF image tile:", imageUrl, e);
                state.imageLoadError = "Error loading image tile. See console.";
                state.isLoadingImage = false;
                state.loadedIIIFImage = null;
                redraw();
            };
            img.src = imageUrl;
            if (!state.loadedIIIFImage) redraw(); // Show loading message if no image currently displayed
        }

        // --- Coordinate Transformation Helpers ---
        function rawCanvasToOriginal(canvasX, canvasY) {
            if (!state.loadedIIIFImage || !state.loadedIIIFImage.requestedRegion || state.imgDrawDetails.width === 0) return null;

            const d = state.imgDrawDetails; // {x, y, width, height} of drawn image on canvas
            const r = state.loadedIIIFImage.requestedRegion; // {x, y, w, h} of region in original image

            const x_in_drawn_img = canvasX - d.x;
            const y_in_drawn_img = canvasY - d.y;

            if (x_in_drawn_img < 0 || x_in_drawn_img >= d.width || y_in_drawn_img < 0 || y_in_drawn_img >= d.height) {
                return null; // Clicked outside drawn image
            }
            const propX = x_in_drawn_img / d.width;
            const propY = y_in_drawn_img / d.height;

            return { x: r.x + propX * r.w, y: r.y + propY * r.h };
        }

        function originalToFinalCanvas(origX, origY) {
            if (!state.loadedIIIFImage || !state.loadedIIIFImage.requestedRegion || state.imgDrawDetails.width === 0) {
                 return {x: 0, y:0}; // Should ideally not be called if image not ready
            }
            const d = state.imgDrawDetails;
            const r = state.loadedIIIFImage.requestedRegion;

            const x_in_region = origX - r.x;
            const y_in_region = origY - r.y;
            // Ensure no division by zero if region width/height is somehow zero
            const propX = r.w > 0 ? x_in_region / r.w : 0;
            const propY = r.h > 0 ? y_in_region / r.h : 0;
            
            return { x: d.x + propX * d.width, y: d.y + propY * d.height };
        }

        function redraw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (state.imageLoadError) {
                ctx.fillStyle = 'red'; ctx.font = '16px Arial'; ctx.textAlign = 'center';
                ctx.fillText(state.imageLoadError, canvas.width / 2, canvas.height / 2);
                if (state.isLoadingImage) ctx.fillText("Loading...", canvas.width / 2, canvas.height / 2 + 20);
                return;
            }
            
            if (state.isLoadingImage && !state.loadedIIIFImage) {
                ctx.fillStyle = 'gray'; ctx.font = '16px Arial'; ctx.textAlign = 'center';
                ctx.fillText("Loading image...", canvas.width / 2, canvas.height / 2);
            }

            if (state.loadedIIIFImage && state.loadedIIIFImage.image.naturalWidth > 0) {
                const imgObj = state.loadedIIIFImage.image;
                const imgAspectRatio = imgObj.naturalWidth / imgObj.naturalHeight;
                const canvasAspectRatio = canvas.width / canvas.height;
                let drawWidth, drawHeight, offsetX, offsetY;

                if (imgAspectRatio > canvasAspectRatio) {
                    drawWidth = canvas.width;
                    drawHeight = canvas.width / imgAspectRatio;
                    offsetX = 0;
                    offsetY = (canvas.height - drawHeight) / 2;
                } else {
                    drawHeight = canvas.height;
                    drawWidth = canvas.height * imgAspectRatio;
                    offsetY = 0;
                    offsetX = (canvas.width - drawWidth) / 2;
                }
                state.imgDrawDetails = { x: offsetX, y: offsetY, width: drawWidth, height: drawHeight };
                ctx.drawImage(imgObj, offsetX, offsetY, drawWidth, drawHeight);

                state.highlightedROIs.forEach(item => {
                    const roi = item.roi;
                    const roi_x1_orig = roi.x * state.originalWidth;
                    const roi_y1_orig = roi.y * state.originalHeight;
                    const roi_x2_orig = (roi.x + roi.w) * state.originalWidth;
                    const roi_y2_orig = (roi.y + roi.h) * state.originalHeight;

                    const topLeftCanvas = originalToFinalCanvas(roi_x1_orig, roi_y1_orig);
                    const bottomRightCanvas = originalToFinalCanvas(roi_x2_orig, roi_y2_orig);
                    
                    ctx.fillStyle = item.color;
                    ctx.fillRect(topLeftCanvas.x, topLeftCanvas.y, 
                                 bottomRightCanvas.x - topLeftCanvas.x, 
                                 bottomRightCanvas.y - topLeftCanvas.y);
                });

            } else if (!state.isLoadingImage && !state.imageLoadError && (!state.baseParsedURN || !state.originalWidth)) {
                ctx.fillStyle = 'gray'; ctx.font = '16px Arial'; ctx.textAlign = 'center';
                const message = !state.baseParsedURN ? "Initializing..." : "Loading info...";
                ctx.fillText(message, canvas.width / 2, canvas.height / 2);
                return;
            }

            if (state.isSelecting && state.currentSelectionRectCanvas) {
                ctx.fillStyle = "rgba(0, 100, 255, 0.3)";
                ctx.strokeStyle = "rgba(0, 100, 255, 0.8)";
                ctx.lineWidth = 1;
                const r = state.currentSelectionRectCanvas;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            }
        }

        // --- Cursor Update Logic ---
        function updateCursor() {
            if (!state.mouseOverCanvas) {
                canvas.style.cursor = 'default';
                return;
            }
            // Check for Alt/Option key (e.altKey for most, e.metaKey for Option on Mac in some browsers/setups)
            const isOptionKeyDown = state.altKeyDown || (event && event.metaKey && navigator.platform.toUpperCase().indexOf('MAC') >= 0);

            if (isOptionKeyDown) {
                canvas.style.cursor = 'crosshair';
            } else if (state.shiftKeyDown) {
                canvas.style.cursor = 'help';
            } else if (state.isPanning) {
                canvas.style.cursor = 'grabbing';
            } else {
                canvas.style.cursor = 'grab';
            }
        }
        
        // --- Event Handlers ---
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (!state.loadedIIIFImage || state.imgDrawDetails.width === 0) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX_canvas = e.clientX - rect.left;
            const mouseY_canvas = e.clientY - rect.top;

            const mousePointOrig = rawCanvasToOriginal(mouseX_canvas, mouseY_canvas);
            if (!mousePointOrig) return; 

            const zoomFactorOnWheel = e.deltaY < 0 ? 1.2 : 1 / 1.2;
            const oldZoom = state.currentZoom;
            let newZoom = oldZoom * zoomFactorOnWheel;
            newZoom = Math.max(state.options.minZoomFactor, Math.min(newZoom, state.options.maxZoomFactor));
            if (newZoom === oldZoom) return; // No change in zoom
            state.currentZoom = newZoom;
            
            const relMouseX_in_drawn = (mouseX_canvas - state.imgDrawDetails.x) / state.imgDrawDetails.width;
            const relMouseY_in_drawn = (mouseY_canvas - state.imgDrawDetails.y) / state.imgDrawDetails.height;

            const newViewW_orig = canvas.width / state.currentZoom;
            const newViewH_orig = canvas.height / state.currentZoom;

            state.viewCenterX_orig = mousePointOrig.x - (relMouseX_in_drawn - 0.5) * newViewW_orig;
            state.viewCenterY_orig = mousePointOrig.y - (relMouseY_in_drawn - 0.5) * newViewH_orig;
            
            debouncedRequestImageAndRedraw();
        });

        canvas.addEventListener('mousedown', e => {
            if (!state.loadedIIIFImage) return;
            updateCursor(); // Ensure cursor reflects current key state on mousedown

            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            const clickOrig = rawCanvasToOriginal(currentX, currentY);

            const isOptionKeyDown = e.altKey || (e.metaKey && navigator.platform.toUpperCase().indexOf('MAC') >= 0);

            if (isOptionKeyDown) { 
                if (clickOrig) { 
                    state.isSelecting = true;
                    state.isPanning = false; 
                    state.selectionStartCanvas = { x: currentX, y: currentY };
                    state.currentSelectionRectCanvas = { x: currentX, y: currentY, w: 0, h: 0 };
                }
            } else if (!e.shiftKey) { 
                if (clickOrig) {
                    state.isPanning = true;
                    state.isSelecting = false;
                    state.panStart_orig = clickOrig;
                    state.panStartViewCenter = { x: state.viewCenterX_orig, y: state.viewCenterY_orig };
                    updateCursor(); // Set to 'grabbing'
                }
            }
        });

        canvas.addEventListener('mousemove', e => {
            if (!state.mouseOverCanvas) updateCursor(); // If keys changed while mouse was outside
            if (!state.loadedIIIFImage) return;
            
            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            
            if (state.isPanning) {
                const currentPointOrig = rawCanvasToOriginal(currentX, currentY);
                if (currentPointOrig && state.panStart_orig) {
                    const dx_orig = currentPointOrig.x - state.panStart_orig.x;
                    const dy_orig = currentPointOrig.y - state.panStart_orig.y;
                    state.viewCenterX_orig = state.panStartViewCenter.x - dx_orig;
                    state.viewCenterY_orig = state.panStartViewCenter.y - dy_orig;
                    debouncedRequestImageAndRedraw();
                }
            } else if (state.isSelecting) {
                const x = Math.min(state.selectionStartCanvas.x, currentX);
                const y = Math.min(state.selectionStartCanvas.y, currentY);
                const w = Math.abs(state.selectionStartCanvas.x - currentX);
                const h = Math.abs(state.selectionStartCanvas.y - currentY);
                state.currentSelectionRectCanvas = { x, y, w, h };
                redraw(); 
            }
        });

        canvas.addEventListener('mouseup', e => {
            if (!state.loadedIIIFImage) return;
            
            if (state.isPanning) {
                state.isPanning = false;
            } else if (state.isSelecting) {
                state.isSelecting = false;
                const selRectCanvas = state.currentSelectionRectCanvas;
                state.currentSelectionRectCanvas = null; 

                if (selRectCanvas && selRectCanvas.w > 5 && selRectCanvas.h > 5) {
                    const tl_orig = rawCanvasToOriginal(selRectCanvas.x, selRectCanvas.y);
                    const br_orig = rawCanvasToOriginal(selRectCanvas.x + selRectCanvas.w, selRectCanvas.y + selRectCanvas.h);

                    if (tl_orig && br_orig) {
                        const roi_x1_orig = Math.min(tl_orig.x, br_orig.x); // Handle drag direction
                        const roi_y1_orig = Math.min(tl_orig.y, br_orig.y);
                        const roi_x2_orig = Math.max(tl_orig.x, br_orig.x);
                        const roi_y2_orig = Math.max(tl_orig.y, br_orig.y);

                        const roi_x_pct = Math.max(0, Math.min(1, roi_x1_orig / state.originalWidth));
                        const roi_y_pct = Math.max(0, Math.min(1, roi_y1_orig / state.originalHeight));
                        const roi_w_pct = Math.max(0, Math.min(1 - roi_x_pct, (roi_x2_orig - roi_x1_orig) / state.originalWidth));
                        const roi_h_pct = Math.max(0, Math.min(1 - roi_y_pct, (roi_y2_orig - roi_y1_orig) / state.originalHeight));

                        if (roi_w_pct > 0.001 && roi_h_pct > 0.001) {
                            const newRoiUrn = `${state.baseParsedURN.baseUrn}@${roi_x_pct.toFixed(4)},${roi_y_pct.toFixed(4)},${roi_w_pct.toFixed(4)},${roi_h_pct.toFixed(4)}`;
                            if (!state.highlightedROIs.some(r => r.urn === newRoiUrn)) {
                               state.highlightedROIs.push({
                                    urn: newRoiUrn,
                                    roi: { x: roi_x_pct, y: roi_y_pct, w: roi_w_pct, h: roi_h_pct },
                                    color: getRandomColor()
                                });
                            }
                            state.options.onRectangleSelected(state.highlightedROIs.map(r => r.urn).join('\n'));
                        }
                    }
                }
                redraw(); 
            }
            updateCursor(); // Reset cursor from 'grabbing' or if keys changed
        });
        
        canvas.addEventListener('mouseenter', () => {
            state.mouseOverCanvas = true;
            updateCursor();
        });
        canvas.addEventListener('mouseleave', (e) => {
            state.mouseOverCanvas = false;
            // Only reset cursor if not actively panning/selecting and mouse button is up
            if (!e.buttons) { // e.buttons is a bitmask of pressed buttons
                if (state.isPanning) state.isPanning = false;
                if (state.isSelecting) {
                    state.isSelecting = false;
                    state.currentSelectionRectCanvas = null;
                    redraw();
                }
                updateCursor(); // this will set to default if no keys pressed
            } else if (state.isPanning || state.isSelecting) {
                // If button is still down, keep current interaction cursor (grabbing/crosshair)
                // The 'mouseup' on window will handle stopping interaction if mouse released outside canvas
            } else {
                 updateCursor(); // Should go to default
            }
        });

        canvas.addEventListener('click', e => {
            if (!state.loadedIIIFImage || !e.shiftKey) return; 
            e.preventDefault(); 

            const rect = canvas.getBoundingClientRect();
            const clickX_canvas = e.clientX - rect.left;
            const clickY_canvas = e.clientY - rect.top;

            const clickPointOrig = rawCanvasToOriginal(clickX_canvas, clickY_canvas);
            if (!clickPointOrig) {
                state.options.onQuery([]);
                return;
            }
            const clickX_pct = clickPointOrig.x / state.originalWidth;
            const clickY_pct = clickPointOrig.y / state.originalHeight;

            const matchingUrns = state.highlightedROIs
                .filter(item => {
                    const r = item.roi;
                    return clickX_pct >= r.x && clickX_pct <= r.x + r.w &&
                           clickY_pct >= r.y && clickY_pct <= r.y + r.h;
                })
                .map(item => item.urn);
            state.options.onQuery(matchingUrns);
        });

        const keydownListener = (e) => {
            let changed = false;
            if (e.key === 'Alt' || e.key === 'Meta') { if(!state.altKeyDown) {state.altKeyDown = true; changed=true;} }
            else if (e.key === 'Shift') { if(!state.shiftKeyDown) {state.shiftKeyDown = true; changed=true;} }
            if(changed && state.mouseOverCanvas) updateCursor();
        };
        const keyupListener = (e) => {
            let changed = false;
            if (e.key === 'Alt' || e.key === 'Meta') { if(state.altKeyDown) {state.altKeyDown = false; changed=true;} }
            else if (e.key === 'Shift') { if(state.shiftKeyDown) {state.shiftKeyDown = false; changed=true;} }
            
            // If a key is released that was part of an active operation (e.g. Alt during selection)
            // and mouse button is still down, we might need to cancel the operation or change mode.
            // For simplicity, just update cursor. If mouseup happens, it will finalize based on current state.
            if (changed && state.mouseOverCanvas) updateCursor();
            
            // If mouse button is up and option key released during selection, cancel selection
            if (!e.buttons && state.isSelecting && (e.key === 'Alt' || e.key === 'Meta')) {
                state.isSelecting = false;
                state.currentSelectionRectCanvas = null;
                redraw();
                updateCursor();
            }
        };
        window.addEventListener('keydown', keydownListener);
        window.addEventListener('keyup', keyupListener);
        
        // Handle mouseup outside canvas to stop panning/selection
        const windowMouseUpListener = (e) => {
            if (state.isPanning) {
                state.isPanning = false;
                if (state.mouseOverCanvas) updateCursor(); else canvas.style.cursor = 'default';
            }
            if (state.isSelecting) { // Finalize or cancel selection
                canvas.dispatchEvent(new MouseEvent('mouseup', e)); // Simulate mouseup on canvas
            }
        };
        window.addEventListener('mouseup', windowMouseUpListener);

        const blurListener = () => { // Reset keys if window loses focus
            if (state.altKeyDown || state.shiftKeyDown) {
                state.altKeyDown = false;
                state.shiftKeyDown = false;
                if (state.mouseOverCanvas) updateCursor();
            }
        };
        window.addEventListener('blur', blurListener);

        // --- Initialize ---
        if (!parseInitialUrns(urnOrUrns)) {
            redraw(); 
        } else {
            if (canvas.width > 0 && canvas.height > 0) {
                fetchImageInfo();
            }
            // else, ResizeObserver/requestAnimationFrame will handle initial fetchImageInfo
        }

        // --- Viewer API ---
        return {
            destroy: () => {
                observer.disconnect();
                window.removeEventListener('keydown', keydownListener);
                window.removeEventListener('keyup', keyupListener);
                window.removeEventListener('blur', blurListener);
                window.removeEventListener('mouseup', windowMouseUpListener);
                container.innerHTML = '';
            },
            addROI: (urnWithROI) => {
                const parsed = parseURN(urnWithROI);
                if (parsed.valid && parsed.roi && state.baseParsedURN && parsed.baseUrn === state.baseParsedURN.baseUrn) {
                    if (!state.highlightedROIs.some(r => r.urn === parsed.fullUrn)) {
                        state.highlightedROIs.push({
                            urn: parsed.fullUrn,
                            roi: parsed.roi,
                            color: getRandomColor()
                        });
                        redraw();
                        return true;
                    }
                }
                return false;
            },
            removeROI: (urnWithROI) => {
                const initialLength = state.highlightedROIs.length;
                state.highlightedROIs = state.highlightedROIs.filter(r => r.urn !== urnWithROI);
                if (state.highlightedROIs.length < initialLength) {
                    redraw();
                    return true;
                }
                return false;
            },
            getROIs: () => state.highlightedROIs.map(r => r.urn),
            _getState: () => state // For debugging
        };
    }

    window.HMTIIIF = {
        createViewer: createViewer,
        getIIIFImageUrl: getIIIFImageUrl,
    };

})(window);