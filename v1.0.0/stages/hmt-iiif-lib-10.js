(function(window) {
    'use strict';

    const HMT_IIIF_PROTOCOL = "http";
    const HMT_IIIF_SERVER_BASE = "www.homermultitext.org/iipsrv?IIIF=";
    const HMT_IIIF_PATH_BASE = "/project/homer/pyramidal/deepzoom";

    const ROI_COLORS_PRESET = [ /* ... as before ... */ { r: 255, g: 0, b: 0 },{ r: 0, g: 255, b: 0 },{ r: 0, g: 0, b: 255 },{ r: 255, g: 255, b: 0 },{ r: 255, g: 0, b: 255 },{ r: 0, g: 255, b: 255 },{ r: 255, g: 165, b: 0 },{ r: 128, g: 0, b: 128 }];
    const URN_ROI_OPACITY = 0.3;
    const DRAWN_ROI_OPACITY = 0.5;

    function getRandomRgbaColor(opacity) { /* ... as before ... */ 
        const r = Math.floor(Math.random() * 256);
        const g = Math.floor(Math.random() * 256);
        const b = Math.floor(Math.random() * 256);
        return `rgba(${r},${g},${b},${opacity})`;
    }

    function parseCite2Urn(urnString) { /* ... as before ... */ 
        if (typeof urnString !== 'string') return null;
        const parts = urnString.split(':');
        if (parts.length !== 5 || parts[0] !== 'urn' || parts[1] !== 'cite2') {
            return null;
        }
        const namespace = parts[2];
        const collectionVersion = parts[3].split('.');
        if (collectionVersion.length < 1) {
            return null;
        }
        const collection = collectionVersion[0];
        const version = collectionVersion.length > 1 ? collectionVersion[1] : '';
        
        const lastComponent = parts[4];
        const atSignIndex = lastComponent.indexOf('@');
        let objectId;
        let roi = null;

        if (atSignIndex !== -1) {
            objectId = lastComponent.substring(0, atSignIndex);
            const roiString = lastComponent.substring(atSignIndex + 1);
            const roiParts = roiString.split(',');
            if (roiParts.length === 4) {
                const [x, y, w, h] = roiParts.map(val => parseFloat(val));
                if ([x, y, w, h].every(n => !isNaN(n) && n >= 0 && n <= 1) && (w > 0) && (h > 0)) {
                    roi = { x, y, w, h }; // Store as 0-1 percentages
                }
            }
        } else {
            objectId = lastComponent;
        }

        return {
            urn: urnString,
            namespace: namespace,
            collection: collection,
            version: version,
            objectId: objectId,
            roi: roi
        };
    }
    function buildIIIFImageDataBase(parsedUrn) { /* ... as before ... */ 
        if (!parsedUrn) return null;
        let path = `${HMT_IIIF_PATH_BASE}/${parsedUrn.namespace}/${parsedUrn.collection}`;
        if (parsedUrn.version) {
            path += `/${parsedUrn.version}`;
        }
        path += `/${parsedUrn.objectId}.tif`;
        return path;
    }

    // NEW FUNCTION
    function generateIIIFUrl(urnString, options = {}) {
        const parsedUrn = parseCite2Urn(urnString);
        if (!parsedUrn) {
            console.error("Invalid URN for IIIF URL generation:", urnString);
            return null;
        }

        const iiifImageDataPath = buildIIIFImageDataBase(parsedUrn);
        if (!iiifImageDataPath) {
            console.error("Could not construct IIIF base path for URL generation:", urnString);
            return null;
        }

        let regionParameter = "full";
        if (parsedUrn.roi) {
            const x = parsedUrn.roi.x * 100;
            const y = parsedUrn.roi.y * 100;
            const w = parsedUrn.roi.w * 100;
            const h = parsedUrn.roi.h * 100;
            // IIIF spec suggests rounding or truncating, let's format to a few decimal places if needed, though integers are common for pct.
            // For simplicity and standard IIIF server behavior, integers are fine.
            regionParameter = `pct:${Math.round(x)},${Math.round(y)},${Math.round(w)},${Math.round(h)}`;
        }

        let sizeParameter = "full";
        const reqWidth = options.width ? parseInt(options.width, 10) : null;
        const reqHeight = options.height ? parseInt(options.height, 10) : null;

        if (reqWidth && reqHeight) {
            // Fit within dimensions, maintaining aspect ratio
            sizeParameter = `!${reqWidth},${reqHeight}`;
        } else if (reqWidth) {
            // Scale to width, height auto
            sizeParameter = `${reqWidth},`;
        } else if (reqHeight) {
            // Scale to height, width auto
            sizeParameter = `,${reqHeight}`;
        }
        // If neither, sizeParameter remains "full"

        const rotationParameter = "0";
        const qualityParameter = "default";
        const formatParameter = "jpg";

        return `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/${regionParameter}/${sizeParameter}/${rotationParameter}/${qualityParameter}.${formatParameter}`;
    }


    function createViewer(elementId, urnInput, onRoiDrawnCallback) {
        // ... (createViewer function remains entirely the same as the previous version)
        const container = document.getElementById(elementId);
        if (!container) {
            console.error(`Element with ID '${elementId}' not found.`);
            return;
        }

        let urnStringsArray;
        if (typeof urnInput === 'string') {
            urnStringsArray = [urnInput];
        } else if (Array.isArray(urnInput)) {
            urnStringsArray = urnInput;
        } else {
            container.innerHTML = `<p style="color:red;">Invalid URN input: Must be a string or an array of strings.</p>`;
            return;
        }

        if (urnStringsArray.length === 0) {
            container.innerHTML = `<p style="color:red;">No URNs provided.</p>`;
            return;
        }

        container.innerHTML = '';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';

        const imgElement = document.createElement('img');
        imgElement.style.position = 'absolute';
        imgElement.style.top = '0';
        imgElement.style.left = '0';
        imgElement.draggable = false;
        imgElement.alt = `IIIF image for ${urnStringsArray[0]}`;
        container.appendChild(imgElement);
        
        const spinner = document.createElement('div');
        spinner.innerHTML = 'Loading...';
        spinner.style.position = 'absolute';
        spinner.style.top = '50%';
        spinner.style.left = '50%';
        spinner.style.transform = 'translate(-50%, -50%)';
        spinner.style.padding = '10px';
        spinner.style.background = 'rgba(255,255,255,0.8)';
        spinner.style.borderRadius = '5px';
        spinner.style.display = 'none';
        container.appendChild(spinner);

        let roisData = []; 
        let imageInfo = null;
        let viewportWidth = container.clientWidth;
        let viewportHeight = container.clientHeight;
        let currentScale = 1.0;
        let centerXOrig = 0, centerYOrig = 0;
        let isDragging = false, lastMouseX = 0, lastMouseY = 0;
        let renderTimeout = null;
        const DEBOUNCE_DELAY = 150;
        let lastRequestedRegion = { x: 0, y: 0, w: 0, h: 0 };

        let isAltKeyDown = false;
        let isDrawingRectangle = false;
        let drawStartX = 0, drawStartY = 0;
        let tempDrawRectElement = null;
        let baseUrnForDrawing = '';

        const parsedUrns = urnStringsArray.map(urnStr => parseCite2Urn(urnStr)).filter(Boolean);
        if (parsedUrns.length === 0) {
            container.innerHTML = `<p style="color:red;">No valid URNs could be parsed.</p>`;
            return;
        }

        const primaryParsedUrn = parsedUrns[0];
        baseUrnForDrawing = `${primaryParsedUrn.urn.split('@')[0]}`;
        const baseImageObjectId = primaryParsedUrn.objectId;

        for (let i = 1; i < parsedUrns.length; i++) {
            if (parsedUrns[i].objectId !== baseImageObjectId ||
                parsedUrns[i].namespace !== primaryParsedUrn.namespace ||
                parsedUrns[i].collection !== primaryParsedUrn.collection ||
                parsedUrns[i].version !== primaryParsedUrn.version) {
                console.error("Mismatched base images in URN list.", parsedUrns[i], primaryParsedUrn);
                container.innerHTML = `<p style="color:red;">Error: URNs refer to different base images.</p>`;
                return;
            }
        }

        const iiifImageDataPath = buildIIIFImageDataBase(primaryParsedUrn);
        if (!iiifImageDataPath) {
             container.innerHTML = `<p style="color:red;">Could not construct IIIF path for: ${primaryParsedUrn.urn}</p>`;
            return;
        }
        const infoUrl = `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/info.json`;


        spinner.style.display = 'block';
        fetch(infoUrl, { mode: 'cors' })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error ${response.status} fetching info.json`);
                return response.json();
            })
            .then(info => {
                imageInfo = { width: info.width, height: info.height };
                centerXOrig = imageInfo.width / 2;
                centerYOrig = imageInfo.height / 2;
                currentScale = Math.min(
                    viewportWidth / imageInfo.width,
                    viewportHeight / imageInfo.height
                );

                parsedUrns.forEach((pUrn, index) => {
                    if (pUrn.roi && imageInfo) {
                        const colorObj = ROI_COLORS_PRESET[index % ROI_COLORS_PRESET.length];
                        const colorString = `rgba(${colorObj.r}, ${colorObj.g}, ${colorObj.b}, ${URN_ROI_OPACITY})`;
                        
                        const highlightDiv = document.createElement('div');
                        highlightDiv.style.position = 'absolute';
                        highlightDiv.style.backgroundColor = colorString;
                        highlightDiv.style.boxSizing = 'border-box';
                        highlightDiv.style.pointerEvents = 'none';
                        highlightDiv.style.display = 'none';
                        container.appendChild(highlightDiv);

                        roisData.push({
                            roiOrigPx: {
                                x: pUrn.roi.x * imageInfo.width,
                                y: pUrn.roi.y * imageInfo.height,
                                w: pUrn.roi.w * imageInfo.width,
                                h: pUrn.roi.h * imageInfo.height
                            },
                            element: highlightDiv
                        });
                    }
                });

                constrainState();
                renderImage();
                setupEventListeners();
            })
            .catch(error => { 
                spinner.style.display = 'none';
                container.innerHTML = `<p style="color:red;">Error loading image info: ${error.message}</p>`;
                console.error("IIIF Load Error:", error);
            });

        function scheduleRender() { 
            spinner.style.display = 'block';
            clearTimeout(renderTimeout);
            renderTimeout = setTimeout(renderImage, DEBOUNCE_DELAY);
        }
        function updateHighlightOverlays() { 
            if (!imageInfo || viewportWidth === 0 || viewportHeight === 0) {
                 roisData.forEach(roiItem => { if(roiItem.element) roiItem.element.style.display = 'none';});
                 return;
            }
             if (lastRequestedRegion.w <= 0 || lastRequestedRegion.h <= 0) {
                 roisData.forEach(roiItem => { if(roiItem.element) roiItem.element.style.display = 'none';});
                 return;
             }


            const finalReqX = lastRequestedRegion.x;
            const finalReqY = lastRequestedRegion.y;
            const finalReqW = lastRequestedRegion.w;
            const finalReqH = lastRequestedRegion.h;
            const serverScale = Math.min(viewportWidth / finalReqW, viewportHeight / finalReqH);
            const renderedImageContentWidth = finalReqW * serverScale;
            const renderedImageContentHeight = finalReqH * serverScale;
            const contentOffsetX = (viewportWidth - renderedImageContentWidth) / 2;
            const contentOffsetY = (viewportHeight - renderedImageContentHeight) / 2;

            roisData.forEach(roiItem => {
                const roiOrigPx = roiItem.roiOrigPx;
                const highlightElement = roiItem.element;

                const roiRelToRegionX_orig = roiOrigPx.x - finalReqX;
                const roiRelToRegionY_orig = roiOrigPx.y - finalReqY;
                const roiInContentX_screen = roiRelToRegionX_orig * serverScale;
                const roiInContentY_screen = roiRelToRegionY_orig * serverScale;
                const roiContentWidth_screen = roiOrigPx.w * serverScale;
                const roiContentHeight_screen = roiOrigPx.h * serverScale;

                const highlightDivX = contentOffsetX + roiInContentX_screen;
                const highlightDivY = contentOffsetY + roiInContentY_screen;
                const highlightDivW = roiContentWidth_screen;
                const highlightDivH = roiContentHeight_screen;
                
                if (highlightDivW < 1 || highlightDivH < 1 ||
                    highlightDivX + highlightDivW < 0 || highlightDivX > viewportWidth ||
                    highlightDivY + highlightDivH < 0 || highlightDivY > viewportHeight) {
                    highlightElement.style.display = 'none';
                } else {
                    highlightElement.style.left = `${Math.round(highlightDivX)}px`;
                    highlightElement.style.top = `${Math.round(highlightDivY)}px`;
                    highlightElement.style.width = `${Math.round(highlightDivW)}px`;
                    highlightElement.style.height = `${Math.round(highlightDivH)}px`;
                    highlightElement.style.display = 'block';
                }
            });
        }
        function renderImage() { 
            if (!imageInfo || viewportWidth === 0 || viewportHeight === 0) return;

            let reqWidthOrig = viewportWidth / currentScale;
            let reqHeightOrig = viewportHeight / currentScale;
            let reqXOrig = centerXOrig - reqWidthOrig / 2;
            let reqYOrig = centerYOrig - reqHeightOrig / 2;

            if (reqXOrig < 0) { reqXOrig = 0; }
            if (reqYOrig < 0) { reqYOrig = 0; }

            if (reqXOrig + reqWidthOrig > imageInfo.width) {
                reqWidthOrig = imageInfo.width - reqXOrig;
            }
            if (reqYOrig + reqHeightOrig > imageInfo.height) {
                reqHeightOrig = imageInfo.height - reqYOrig;
            }
            
            reqWidthOrig = Math.max(1, Math.round(reqWidthOrig));
            reqHeightOrig = Math.max(1, Math.round(reqHeightOrig));
            reqXOrig = Math.round(reqXOrig);
            reqYOrig = Math.round(reqYOrig);

            if (reqXOrig + reqWidthOrig > imageInfo.width) reqXOrig = imageInfo.width - reqWidthOrig;
            if (reqYOrig + reqHeightOrig > imageInfo.height) reqYOrig = imageInfo.height - reqHeightOrig;
            if (reqXOrig < 0) reqXOrig = 0;
            if (reqYOrig < 0) reqYOrig = 0;
            if (reqWidthOrig < 1) reqWidthOrig = 1;
            if (reqHeightOrig < 1) reqHeightOrig = 1;

            lastRequestedRegion = { x: reqXOrig, y: reqYOrig, w: reqWidthOrig, h: reqHeightOrig };

            const region = `${reqXOrig},${reqYOrig},${reqWidthOrig},${reqHeightOrig}`;
            const size = `!${viewportWidth},${viewportHeight}`;
            const imageUrl = `${HMT_IIIF_PROTOCOL}://${HMT_IIIF_SERVER_BASE}${iiifImageDataPath}/${region}/${size}/0/default.jpg`;
            
            imgElement.src = imageUrl;
            imgElement.style.width = '100%';
            imgElement.style.height = '100%';
            imgElement.style.objectFit = 'contain';

            updateHighlightOverlays();
        }
        function constrainState() { 
            if (!imageInfo) return;
            const minFitScale = Math.min(viewportWidth / imageInfo.width, viewportHeight / imageInfo.height);
            currentScale = Math.max(minFitScale / 4, currentScale); 
            currentScale = Math.min(4, currentScale); 

            const effectiveDisplayWidthAtScale = imageInfo.width * currentScale;
            const effectiveDisplayHeightAtScale = imageInfo.height * currentScale;

            if (effectiveDisplayWidthAtScale <= viewportWidth) {
                centerXOrig = imageInfo.width / 2;
            } else {
                const minCenterX = (viewportWidth / 2) / currentScale;
                const maxCenterX = imageInfo.width - (viewportWidth / 2) / currentScale;
                centerXOrig = Math.max(minCenterX, Math.min(maxCenterX, centerXOrig));
            }

            if (effectiveDisplayHeightAtScale <= viewportHeight) {
                centerYOrig = imageInfo.height / 2;
            } else {
                const minCenterY = (viewportHeight / 2) / currentScale;
                const maxCenterY = imageInfo.height - (viewportHeight / 2) / currentScale;
                centerYOrig = Math.max(minCenterY, Math.min(maxCenterY, centerYOrig));
            }
        }
        function screenRectToImagePct(screenX, screenY, screenW, screenH) { 
            if (!imageInfo || lastRequestedRegion.w <= 0 || lastRequestedRegion.h <= 0) return null;

            const finalReqX = lastRequestedRegion.x;
            const finalReqY = lastRequestedRegion.y;
            const finalReqW = lastRequestedRegion.w;
            const finalReqH = lastRequestedRegion.h;
            const serverScale = Math.min(viewportWidth / finalReqW, viewportHeight / finalReqH);
            const renderedImageContentWidth = finalReqW * serverScale;
            const renderedImageContentHeight = finalReqH * serverScale;
            const contentOffsetX = (viewportWidth - renderedImageContentWidth) / 2;
            const contentOffsetY = (viewportHeight - renderedImageContentHeight) / 2;

            const x1_on_content_screen = screenX - contentOffsetX;
            const y1_on_content_screen = screenY - contentOffsetY;
            const x2_on_content_screen = screenX + screenW - contentOffsetX;
            const y2_on_content_screen = screenY + screenH - contentOffsetY;
            
            const x1_on_region_orig = x1_on_content_screen / serverScale;
            const y1_on_region_orig = y1_on_content_screen / serverScale;
            const x2_on_region_orig = x2_on_content_screen / serverScale;
            const y2_on_region_orig = y2_on_content_screen / serverScale;

            let roi_x_orig = finalReqX + x1_on_region_orig;
            let roi_y_orig = finalReqY + y1_on_region_orig;
            let roi_x2_orig = finalReqX + x2_on_region_orig;
            let roi_y2_orig = finalReqY + y2_on_region_orig;

            let roi_w_orig = Math.abs(roi_x2_orig - roi_x_orig);
            let roi_h_orig = Math.abs(roi_y2_orig - roi_y_orig);
            roi_x_orig = Math.min(roi_x_orig, roi_x2_orig);
            roi_y_orig = Math.min(roi_y_orig, roi_y2_orig);

            roi_x_orig = Math.max(0, Math.min(roi_x_orig, imageInfo.width));
            roi_y_orig = Math.max(0, Math.min(roi_y_orig, imageInfo.height));
            
            roi_w_orig = Math.min(roi_w_orig, imageInfo.width - roi_x_orig);
            roi_h_orig = Math.min(roi_h_orig, imageInfo.height - roi_y_orig);

            if (roi_w_orig <= 0 || roi_h_orig <= 0) return null;

            const pctX = roi_x_orig / imageInfo.width;
            const pctY = roi_y_orig / imageInfo.height;
            const pctW = roi_w_orig / imageInfo.width;
            const pctH = roi_h_orig / imageInfo.height;

            return {
                x: parseFloat(pctX.toFixed(4)),
                y: parseFloat(pctY.toFixed(4)),
                w: parseFloat(pctW.toFixed(4)),
                h: parseFloat(pctH.toFixed(4))
            };
        }

        function setupEventListeners() {
            window.addEventListener('keydown', (event) => {
                if (event.key === 'Alt') {
                    event.preventDefault(); 
                    isAltKeyDown = true; 
                    if(!isDrawingRectangle) container.style.cursor = 'crosshair';
                }
            });
            window.addEventListener('keyup', (event) => {
                if (event.key === 'Alt') {
                    isAltKeyDown = false; 
                    if(!isDrawingRectangle && !isDragging) container.style.cursor = 'grab';
                }
            });

            container.addEventListener('wheel', function(event) { 
                if (isAltKeyDown) { 
                    event.preventDefault(); 
                    return;
                }
                event.preventDefault();
                const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
                const rect = container.getBoundingClientRect();
                const mouseXvp = event.clientX - rect.left;
                const mouseYvp = event.clientY - rect.top;
                
                const idealViewOrigTopLeftX = centerXOrig - (viewportWidth / 2) / currentScale;
                const idealViewOrigTopLeftY = centerYOrig - (viewportHeight / 2) / currentScale;
                const ptXOrig = idealViewOrigTopLeftX + mouseXvp / currentScale;
                const ptYOrig = idealViewOrigTopLeftY + mouseYvp / currentScale;
                
                currentScale *= zoomFactor;
                constrainState(); 

                const newIdealViewOrigTopLeftX = ptXOrig - (mouseXvp / currentScale);
                const newIdealViewOrigTopLeftY = ptYOrig - (mouseYvp / currentScale);
                centerXOrig = newIdealViewOrigTopLeftX + (viewportWidth / 2) / currentScale;
                centerYOrig = newIdealViewOrigTopLeftY + (viewportHeight / 2) / currentScale;
                
                constrainState(); 
                scheduleRender();
            });

            container.addEventListener('mousedown', function(event) { 
                if (event.button !== 0) return;
                event.preventDefault();
                const rect = container.getBoundingClientRect();
                const mouseXvp = event.clientX - rect.left;
                const mouseYvp = event.clientY - rect.top;

                if (isAltKeyDown) { 
                    isDrawingRectangle = true;
                    drawStartX = mouseXvp;
                    drawStartY = mouseYvp;

                    if (tempDrawRectElement) tempDrawRectElement.remove();
                    tempDrawRectElement = document.createElement('div');
                    tempDrawRectElement.style.position = 'absolute';
                    tempDrawRectElement.style.border = '2px dashed blue'; 
                    tempDrawRectElement.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
                    tempDrawRectElement.style.left = `${drawStartX}px`;
                    tempDrawRectElement.style.top = `${drawStartY}px`;
                    tempDrawRectElement.style.width = '0px';
                    tempDrawRectElement.style.height = '0px';
                    tempDrawRectElement.style.pointerEvents = 'none';
                    container.appendChild(tempDrawRectElement);
                    container.style.cursor = 'crosshair';
                } else {
                    isDragging = true;
                    lastMouseX = event.clientX;
                    lastMouseY = event.clientY;
                    container.style.cursor = 'grabbing';
                }
            });

            container.addEventListener('mousemove', function(event) { 
                const rect = container.getBoundingClientRect();
                const mouseXvp = event.clientX - rect.left;
                const mouseYvp = event.clientY - rect.top;

                if (isDrawingRectangle && isAltKeyDown) { 
                    if (tempDrawRectElement) {
                        const currentX = mouseXvp;
                        const currentY = mouseYvp;
                        const newX = Math.min(drawStartX, currentX);
                        const newY = Math.min(drawStartY, currentY);
                        const newW = Math.abs(drawStartX - currentX);
                        const newH = Math.abs(drawStartY - currentY);
                        tempDrawRectElement.style.left = `${newX}px`;
                        tempDrawRectElement.style.top = `${newY}px`;
                        tempDrawRectElement.style.width = `${newW}px`;
                        tempDrawRectElement.style.height = `${newH}px`;
                    }
                } else if (isDragging) {
                    const dx = event.clientX - lastMouseX;
                    const dy = event.clientY - lastMouseY;
                    lastMouseX = event.clientX;
                    lastMouseY = event.clientY;

                    centerXOrig -= dx / currentScale; 
                    centerYOrig -= dy / currentScale;
                    
                    constrainState();
                    scheduleRender();
                }
            });

            container.addEventListener('mouseup', function(event) {
                if (event.button !== 0) return;

                if (isDrawingRectangle && isAltKeyDown) {
                    if (tempDrawRectElement) {
                        const rect = tempDrawRectElement.getBoundingClientRect();
                        const containerRect = container.getBoundingClientRect();
                        
                        const finalDrawX = rect.left - containerRect.left;
                        const finalDrawY = rect.top - containerRect.top;
                        const finalDrawW = rect.width;
                        const finalDrawH = rect.height;

                        tempDrawRectElement.remove(); 
                        tempDrawRectElement = null;

                        if (finalDrawW > 2 && finalDrawH > 2 && imageInfo) { 
                            const roiPct = screenRectToImagePct(finalDrawX, finalDrawY, finalDrawW, finalDrawH);
                            if (roiPct) {
                                if (typeof onRoiDrawnCallback === 'function') {
                                    const roiStringForCallback = `@${roiPct.x},${roiPct.y},${roiPct.w},${roiPct.h}`;
                                    onRoiDrawnCallback(baseUrnForDrawing + roiStringForCallback);
                                }

                                const newRoiOrigPx = {
                                    x: roiPct.x * imageInfo.width,
                                    y: roiPct.y * imageInfo.height,
                                    w: roiPct.w * imageInfo.width,
                                    h: roiPct.h * imageInfo.height
                                };
                                const randomColor = getRandomRgbaColor(DRAWN_ROI_OPACITY);
                                const newHighlightDiv = document.createElement('div');
                                newHighlightDiv.style.position = 'absolute';
                                newHighlightDiv.style.backgroundColor = randomColor;
                                newHighlightDiv.style.boxSizing = 'border-box';
                                newHighlightDiv.style.pointerEvents = 'none';
                                newHighlightDiv.style.display = 'none'; 
                                container.appendChild(newHighlightDiv);

                                roisData.push({
                                    roiOrigPx: newRoiOrigPx,
                                    element: newHighlightDiv
                                });
                                updateHighlightOverlays(); 
                            }
                        }
                    }
                    isDrawingRectangle = false;
                    container.style.cursor = isAltKeyDown ? 'crosshair' : 'grab';
                } else if (isDragging) {
                    isDragging = false;
                    container.style.cursor = isAltKeyDown ? 'crosshair' : 'grab';
                }
            });

            container.addEventListener('mouseleave', function() { 
                if (isDrawingRectangle) { 
                    if (tempDrawRectElement) tempDrawRectElement.remove();
                    tempDrawRectElement = null;
                    isDrawingRectangle = false;
                }
                if (isDragging) {
                    isDragging = false;
                }
                container.style.cursor = isAltKeyDown ? 'crosshair' : 'grab';
            });
            
            container.style.cursor = 'grab';
            window.addEventListener('resize', function() { 
                clearTimeout(renderTimeout);
                renderTimeout = setTimeout(() => {
                    viewportWidth = container.clientWidth;
                    viewportHeight = container.clientHeight;
                    constrainState();
                    renderImage();
                }, DEBOUNCE_DELAY + 50);
            });
        } 
    } 


    // Expose public functions
    window.HMTIIIFViewer = {
        createViewer: createViewer,
        generateIIIFUrl: generateIIIFUrl // New function exposed
    };

})(window);