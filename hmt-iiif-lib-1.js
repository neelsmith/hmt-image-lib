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
        // If ROI is present, size applies to the region. If no size option, IIIF default is to return region at its 'full' size.

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
        // Style canvas for fixed size, or use ResizeObserver for responsive
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.border = "1px solid #ccc";
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        // Set canvas resolution to match its display size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;

        let state = {
            baseParsedURN: null,
            originalWidth: 0,
            originalHeight: 0,
            currentZoom: 1.0, // zoom factor: 1.0 = original pixels match screen pixels if canvas were large enough
            viewCenterX_orig: 0, // center of view in original image coordinates
            viewCenterY_orig: 0,
            topLeftX_orig_clamped: 0, // Top-left of visible part in original image coords (clamped)
            topLeftY_orig_clamped: 0,
            loadedIIIFImage: null,
            highlightedROIs: [], // { urn, roi: {x,y,w,h}, color }
            isPanning: false,
            panStart: { x: 0, y: 0 },
            panStartViewCenter: { x: 0, y: 0 },
            isSelecting: false,
            selectionStartCanvas: { x: 0, y: 0 },
            currentSelectionRectCanvas: null, // {x,y,w,h} on canvas
            imageLoadError: null,
            isLoadingImage: false,
            options: {
                onRectangleSelected: viewerOptions.onRectangleSelected || function() {},
                onQuery: viewerOptions.onQuery || function() {},
                minZoomFactor: 0.1, // Relative to "fit to screen"
                maxZoomFactor: 10,  // Relative to "1 original pixel = 1 canvas pixel"
            }
        };

        function parseInitialUrns(inputUrns) {
            const initialRois = [];
            let baseUrnToUse = null;

            const urnArray = Array.isArray(inputUrns) ? inputUrns : [inputUrns];

            for (let i = 0; i < urnArray.length; i++) {
                const parsed = parseURN(urnArray[i]);
                if (!parsed.valid) {
                    console.error("Invalid URN provided for viewer:", parsed.error, urnArray[i]);
                    if (i === 0) { // Critical if first URN is bad
                        state.imageLoadError = `Invalid base URN: ${parsed.error}`;
                        return false;
                    }
                    continue; // Skip bad ROIs
                }

                if (i === 0) {
                    state.baseParsedURN = parsed; // Uses objectId, namespace etc. from first URN
                    baseUrnToUse = parsed.baseUrn;
                } else if (parsed.baseUrn !== baseUrnToUse) {
                    console.warn("All URNs in array must share the same base image. Skipping:", urnArray[i]);
                    continue;
                }

                if (parsed.roi) {
                    // Avoid duplicates if same ROI URN is passed multiple times
                    if (!initialRois.some(r => r.urn === parsed.fullUrn)) {
                         initialRois.push({
                            urn: parsed.fullUrn, // Store the full URN as given
                            roi: parsed.roi, // {x,y,w,h} in percentages
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
                console.error("Base URN not set, cannot fetch image info.");
                state.imageLoadError = "Base URN not properly parsed.";
                redraw(); // Show error on canvas
                return;
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
                    
                    // Initial zoom to fit image to canvas
                    const scaleX = canvas.width / state.originalWidth;
                    const scaleY = canvas.height / state.originalHeight;
                    state.currentZoom = Math.min(scaleX, scaleY);
                    state.options.minZoomFactor = state.currentZoom * 0.1; // Adjust minZoom based on fit
                    
                    requestImageAndRedraw();
                })
                .catch(error => {
                    console.error("Error fetching IIIF info.json:", error);
                    state.imageLoadError = `Failed to load image info: ${error.message}. Check console for details.`;
                    redraw(); // Show error state on canvas
                });
        }

        const debouncedRequestImageAndRedraw = debounce(requestImageAndRedraw, 250);

        function requestImageAndRedraw() {
            if (!state.originalWidth || !state.originalHeight || state.isLoadingImage) return;
            state.isLoadingImage = true;
            state.imageLoadError = null; // Clear previous errors

            // Calculate viewport in original image coordinates
            const viewPortWidth_orig = canvas.width / state.currentZoom;
            const viewPortHeight_orig = canvas.height / state.currentZoom;

            let topLeftX_orig = state.viewCenterX_orig - viewPortWidth_orig / 2;
            let topLeftY_orig = state.viewCenterY_orig - viewPortHeight_orig / 2;

            // Clamp to image boundaries
            state.topLeftX_orig_clamped = Math.max(0, Math.min(topLeftX_orig, state.originalWidth - viewPortWidth_orig));
            state.topLeftY_orig_clamped = Math.max(0, Math.min(topLeftY_orig, state.originalHeight - viewPortHeight_orig));
            
            // If clamping changed topLeft, it means view was partly outside. Adjust actual topLeft to reflect this.
            // This is subtle. We want the region to be correct for IIIF.
            // The region width/height should be viewPortWidth_orig, viewPortHeight_orig unless these are larger than original image.
            const regionX = Math.max(0, topLeftX_orig);
            const regionY = Math.max(0, topLeftY_orig);
            const regionW = Math.min(viewPortWidth_orig, state.originalWidth - regionX);
            const regionH = Math.min(viewPortHeight_orig, state.originalHeight - regionY);
            
            const iiifRegion = `${Math.round(regionX)},${Math.round(regionY)},${Math.round(regionW)},${Math.round(regionH)}`;
            const iiifSize = `${canvas.width},${canvas.height}`; // Request image scaled to canvas size (IIIF '!w,h' would be better, but problem asks for w,h)
                                                              // using `canvas.width,` or `,canvas.height` or `!cW,cH` is more typical. `w,h` might distort.
                                                              // Let's use `!w,h` as it's best practice for IIIF.
            const iiifSizeParam = `!${canvas.width},${canvas.height}`;


            const imageUrl = `${IIIF_SERVER_PROTOCOL}://${IIIF_SERVER_HOST}${IIIF_SERVER_PATH}` +
                             `${HMT_IIIF_PREFIX_BASE}/${state.baseParsedURN.namespace}/${state.baseParsedURN.collectionParts[0]}/${state.baseParsedURN.collectionParts[1]}/${state.baseParsedURN.objectId}.tif` +
                             `/${iiifRegion}/${iiifSizeParam}/0/default.jpg`;

            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                state.loadedIIIFImage = img;
                state.isLoadingImage = false;
                redraw();
            };
            img.onerror = (e) => {
                console.error("Error loading IIIF image tile:", imageUrl, e);
                state.imageLoadError = "Error loading image tile. See console.";
                state.isLoadingImage = false;
                state.loadedIIIFImage = null; // Ensure no stale image is drawn
                redraw();
            };
            img.src = imageUrl;
            redraw(); // Show loading state
        }

        function redraw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (state.imageLoadError) {
                ctx.fillStyle = 'red';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(state.imageLoadError, canvas.width / 2, canvas.height / 2);
                if (state.isLoadingImage) {
                     ctx.fillText("Loading image...", canvas.width / 2, canvas.height / 2 + 20);
                }
                return;
            }
            
            if (state.isLoadingImage && !state.loadedIIIFImage) { // Show loading only if no image is currently displayed
                ctx.fillStyle = 'gray';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText("Loading image...", canvas.width / 2, canvas.height / 2);
            }

            if (state.loadedIIIFImage) {
                // The loadedIIIFImage is already cropped and scaled by IIIF to fit the canvas.
                // We need to calculate the offset if the requested region was clamped differently
                // than state.topLeftX_orig_clamped.
                // The IIIF image corresponds to a region starting at some `actualRegionX_orig`
                // and we want to display the part that corresponds to `state.topLeftX_orig_clamped`.
                // This is simplified because IIIF gives us an image scaled to canvas.width/height
                // from the requested region. We just draw it at 0,0.
                ctx.drawImage(state.loadedIIIFImage, 0, 0, canvas.width, canvas.height);
            } else if (!state.isLoadingImage && !state.imageLoadError && !state.baseParsedURN) {
                // Initial state before info.json loaded or if base URN was bad
                ctx.fillStyle = 'gray';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText("Initializing viewer...", canvas.width / 2, canvas.height / 2);
                return;
            } else if (!state.isLoadingImage && !state.imageLoadError && !state.originalWidth) {
                ctx.fillStyle = 'gray';
                ctx.font = '16px Arial';
                ctx.textAlign = 'center';
                ctx.fillText("Loading image information...", canvas.width / 2, canvas.height / 2);
                return;
            }


            // Draw highlighted ROIs
            state.highlightedROIs.forEach(item => {
                const roi = item.roi; // {x,y,w,h} in percentages of original image
                const roi_x_orig = roi.x * state.originalWidth;
                const roi_y_orig = roi.y * state.originalHeight;
                const roi_w_orig = roi.w * state.originalWidth;
                const roi_h_orig = roi.h * state.originalHeight;

                // Convert ROI original coordinates to canvas coordinates
                const canvas_roi_x = (roi_x_orig - state.topLeftX_orig_clamped) * state.currentZoom;
                const canvas_roi_y = (roi_y_orig - state.topLeftY_orig_clamped) * state.currentZoom;
                const canvas_roi_w = roi_w_orig * state.currentZoom;
                const canvas_roi_h = roi_h_orig * state.currentZoom;
                
                ctx.fillStyle = item.color;
                ctx.fillRect(canvas_roi_x, canvas_roi_y, canvas_roi_w, canvas_roi_h);
            });

            // Draw current selection rectangle (if any)
            if (state.isSelecting && state.currentSelectionRectCanvas) {
                ctx.fillStyle = "rgba(0, 100, 255, 0.3)";
                ctx.strokeStyle = "rgba(0, 100, 255, 0.8)";
                ctx.lineWidth = 1;
                const r = state.currentSelectionRectCanvas;
                ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeRect(r.x, r.y, r.w, r.h);
            }
        }

        // Event Handlers
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            if (!state.originalWidth) return;

            const rect = canvas.getBoundingClientRect();
            const mouseX_canvas = e.clientX - rect.left;
            const mouseY_canvas = e.clientY - rect.top;

            // Convert mouse position to original image coordinates
            const mouseX_orig = state.topLeftX_orig_clamped + mouseX_canvas / state.currentZoom;
            const mouseY_orig = state.topLeftY_orig_clamped + mouseY_canvas / state.currentZoom;

            const zoomFactor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
            const newZoom = state.currentZoom * zoomFactor;

            // Clamp zoom
            state.currentZoom = Math.max(state.options.minZoomFactor, Math.min(newZoom, state.options.maxZoomFactor));
            
            // Adjust view center so mouse point stays in same place
            state.viewCenterX_orig = mouseX_orig - (mouseX_canvas / state.currentZoom) + ( (canvas.width / state.currentZoom) /2 );
            state.viewCenterY_orig = mouseY_orig - (mouseY_canvas / state.currentZoom) + ( (canvas.height / state.currentZoom) /2 );

            debouncedRequestImageAndRedraw();
        });

        canvas.addEventListener('mousedown', e => {
            if (!state.originalWidth) return;
            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            if (e.altKey || e.metaKey) { // Option key (altKey on Win/Linux, metaKey sometimes for Mac Option)
                state.isSelecting = true;
                state.isPanning = false; // Ensure panning doesn't also happen
                state.selectionStartCanvas = { x: currentX, y: currentY };
                state.currentSelectionRectCanvas = { x: currentX, y: currentY, w: 0, h: 0 };
            } else if (!e.shiftKey) { // Not shift (query) or alt/meta (select) -> pan
                state.isPanning = true;
                state.isSelecting = false;
                state.panStart = { x: e.clientX, y: e.clientY };
                state.panStartViewCenter = { x: state.viewCenterX_orig, y: state.viewCenterY_orig };
            }
        });

        canvas.addEventListener('mousemove', e => {
            if (!state.originalWidth) return;
            const rect = canvas.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            if (state.isPanning) {
                const dx_canvas = e.clientX - state.panStart.x;
                const dy_canvas = e.clientY - state.panStart.y;

                // Convert canvas delta to original image delta
                const dx_orig = dx_canvas / state.currentZoom;
                const dy_orig = dy_canvas / state.currentZoom;

                state.viewCenterX_orig = state.panStartViewCenter.x - dx_orig;
                state.viewCenterY_orig = state.panStartViewCenter.y - dy_orig;
                debouncedRequestImageAndRedraw();
            } else if (state.isSelecting) {
                const x = Math.min(state.selectionStartCanvas.x, currentX);
                const y = Math.min(state.selectionStartCanvas.y, currentY);
                const w = Math.abs(state.selectionStartCanvas.x - currentX);
                const h = Math.abs(state.selectionStartCanvas.y - currentY);
                state.currentSelectionRectCanvas = { x, y, w, h };
                redraw(); // Redraw for live selection rectangle
            }
        });

        canvas.addEventListener('mouseup', e => {
            if (!state.originalWidth) return;
            
            if (state.isPanning) {
                state.isPanning = false;
                // Final image request already triggered by mousemove's debounced call
            } else if (state.isSelecting) {
                state.isSelecting = false;
                const rect = state.currentSelectionRectCanvas;
                state.currentSelectionRectCanvas = null; // Clear temp rect

                if (rect && rect.w > 0 && rect.h > 0) { // Valid rectangle
                    // Convert canvas rect to original image percentage ROI
                    const roi_x1_orig = state.topLeftX_orig_clamped + rect.x / state.currentZoom;
                    const roi_y1_orig = state.topLeftY_orig_clamped + rect.y / state.currentZoom;
                    const roi_x2_orig = state.topLeftX_orig_clamped + (rect.x + rect.w) / state.currentZoom;
                    const roi_y2_orig = state.topLeftY_orig_clamped + (rect.y + rect.h) / state.currentZoom;

                    const roi_x_pct = Math.max(0, Math.min(1, roi_x1_orig / state.originalWidth));
                    const roi_y_pct = Math.max(0, Math.min(1, roi_y1_orig / state.originalHeight));
                    const roi_w_pct = Math.max(0, Math.min(1 - roi_x_pct, (roi_x2_orig - roi_x1_orig) / state.originalWidth));
                    const roi_h_pct = Math.max(0, Math.min(1 - roi_y_pct, (roi_y2_orig - roi_y1_orig) / state.originalHeight));

                    if (roi_w_pct > 0 && roi_h_pct > 0) {
                        const newRoiUrn = `${state.baseParsedURN.baseUrn}@${roi_x_pct.toFixed(4)},${roi_y_pct.toFixed(4)},${roi_w_pct.toFixed(4)},${roi_h_pct.toFixed(4)}`;
                        
                        // Add to highlightedROIs if not already present
                        if (!state.highlightedROIs.some(r => r.urn === newRoiUrn)) {
                           state.highlightedROIs.push({
                                urn: newRoiUrn,
                                roi: { x: roi_x_pct, y: roi_y_pct, w: roi_w_pct, h: roi_h_pct },
                                color: getRandomColor()
                            });
                        }
                        
                        const allUrnsString = state.highlightedROIs.map(r => r.urn).join('\n');
                        state.options.onRectangleSelected(allUrnsString);
                    }
                }
                redraw(); // Redraw to show new ROI or clear selection rect
            }
        });
        
        canvas.addEventListener('mouseleave', e => { // If mouse leaves canvas while panning/selecting
            if (state.isPanning) state.isPanning = false;
            if (state.isSelecting) {
                 state.isSelecting = false;
                 state.currentSelectionRectCanvas = null;
                 redraw(); // Clear selection rectangle if user abandons it
            }
        });

        canvas.addEventListener('click', e => {
            if (!state.originalWidth || !e.shiftKey) return; // Only for shift-click
            e.preventDefault(); // Prevent any default shift-click behavior

            const rect = canvas.getBoundingClientRect();
            const clickX_canvas = e.clientX - rect.left;
            const clickY_canvas = e.clientY - rect.top;

            const clickX_orig = state.topLeftX_orig_clamped + clickX_canvas / state.currentZoom;
            const clickY_orig = state.topLeftY_orig_clamped + clickY_canvas / state.currentZoom;

            const clickX_pct = clickX_orig / state.originalWidth;
            const clickY_pct = clickY_orig / state.originalHeight;

            const matchingUrns = [];
            state.highlightedROIs.forEach(item => {
                const r = item.roi;
                if (clickX_pct >= r.x && clickX_pct <= r.x + r.w &&
                    clickY_pct >= r.y && clickY_pct <= r.y + r.h) {
                    matchingUrns.push(item.urn);
                }
            });
            state.options.onQuery(matchingUrns);
        });

        // Initialize
        if (!parseInitialUrns(urnOrUrns)) {
            redraw(); // Show error if base URN parsing failed
            // Return null or an object that indicates failure? For now, it still returns the instance.
        } else {
            fetchImageInfo();
        }


        // Viewer instance API
        return {
            destroy: () => {
                // Remove event listeners, clear container, etc.
                // For simplicity, this basic version just clears the container.
                // Robust cleanup would remove specific listeners if they were bound outside.
                container.innerHTML = '';
            },
            addROI: (urnWithROI) => {
                const parsed = parseURN(urnWithROI);
                if (parsed.valid && parsed.roi && parsed.baseUrn === state.baseParsedURN.baseUrn) {
                    if (!state.highlightedROIs.some(r => r.urn === parsed.fullUrn)) {
                        state.highlightedROIs.push({
                            urn: parsed.fullUrn,
                            roi: parsed.roi,
                            color: getRandomColor()
                        });
                        redraw();
                        // Optionally, call onRectangleSelected here too or let app decide
                        // const allUrnsString = state.highlightedROIs.map(r => r.urn).join('\n');
                        // state.options.onRectangleSelected(allUrnsString);
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
                    // Optionally, call onRectangleSelected here too
                    // const allUrnsString = state.highlightedROIs.map(r => r.urn).join('\n');
                    // state.options.onRectangleSelected(allUrnsString);
                    return true;
                }
                return false;
            },
            getROIs: () => {
                return state.highlightedROIs.map(r => r.urn);
            },
            getCurrentCanvas: () => canvas, // For debugging or advanced use
            _getState: () => state // For debugging
        };
    }

    // --- Expose to global scope ---
    window.HMTIIIF = {
        createViewer: createViewer,
        getIIIFImageUrl: getIIIFImageUrl,
        _parseURN: parseURN // Expose for testing or advanced use
    };

})(window);