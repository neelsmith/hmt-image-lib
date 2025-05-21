(function(window) {
    'use strict';

    // ... (HMT_IIIF_PROTOCOL, HMT_IIIF_SERVER_BASE, HMT_IIIF_PATH_BASE, ROI_COLORS, ROI_OPACITY as before)
    const HMT_IIIF_PROTOCOL = "http";
    const HMT_IIIF_SERVER_BASE = "www.homermultitext.org/iipsrv?IIIF=";
    const HMT_IIIF_PATH_BASE = "/project/homer/pyramidal/deepzoom";

    const ROI_COLORS = [
        { r: 255, g: 0, b: 0 },    // Red
        { r: 0, g: 255, b: 0 },    // Green
        { r: 0, g: 0, b: 255 },    // Blue
        { r: 255, g: 255, b: 0 },  // Yellow
        { r: 255, g: 0, b: 255 },  // Magenta
        { r: 0, g: 255, b: 255 },  // Cyan
        { r: 255, g: 165, b: 0 },  // Orange
        { r: 128, g: 0, b: 128 },  // Purple
    ];
    const ROI_OPACITY = 0.3;

    function parseCite2Urn(urnString) {
        // ... (parseCite2Urn remains the same)
        if (typeof urnString !== 'string') return null;
        const parts = urnString.split(':');
        if (parts.length !== 5 || parts[0] !== 'urn' || parts[1] !== 'cite2') {
            console.error("Invalid CITE2 URN format:", urnString);
            return null;
        }
        const namespace = parts[2];
        const collectionVersion = parts[3].split('.');
        if (collectionVersion.length < 1) {
             console.error("Invalid collection component in URN:", urnString);
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
                    roi = { x, y, w, h };
                } else {
                    console.warn("Invalid ROI values (must be 0-1, w/h > 0) in URN, ignoring ROI:", roiString);
                }
            } else {
                console.warn("Invalid ROI component count in URN, ignoring ROI:", roiString);
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

    function buildIIIFImageDataBase(parsedUrn) {
        // ... (buildIIIFImageDataBase remains the same)
        if (!parsedUrn) return null;
        let path = `${HMT_IIIF_PATH_BASE}/${parsedUrn.namespace}/${parsedUrn.collection}`;
        if (parsedUrn.version) {
            path += `/${parsedUrn.version}`;
        }
        path += `/${parsedUrn.objectId}.tif`;
        return path;
    }

    // Accepts a single URN string OR an array of URN strings
    function createViewer(elementId, urnInput) { // Renamed second param to urnInput
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

        // Clear container and basic setup
        container.innerHTML = '';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        container.style.cursor = 'grab';

        const imgElement = document.createElement('img');
        imgElement.style.position = 'absolute';
        imgElement.style.top = '0';
        imgElement.style.left = '0';
        imgElement.draggable = false;
        imgElement.alt = `IIIF image for ${urnStringsArray[0]}`; // Alt text from the first URN
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

        let highlightElements = [];
        let roisData = [];

        let imageInfo = null;
        let viewportWidth = container.clientWidth;
        let viewportHeight = container.clientHeight;

        let currentScale = 1.0;
        let centerXOrig = 0;
        let centerYOrig = 0;

        let isDragging = false;
        let lastMouseX = 0;
        let lastMouseY = 0;
        
        let renderTimeout = null;
        const DEBOUNCE_DELAY = 150;
        let lastRequestedRegion = { x: 0, y: 0, w: 0, h: 0 };

        const parsedUrns = urnStringsArray.map(urnStr => parseCite2Urn(urnStr)).filter(Boolean);
        if (parsedUrns.length === 0) {
            container.innerHTML = `<p style="color:red;">No valid URNs could be parsed.</p>`;
            return;
        }

        const primaryParsedUrn = parsedUrns[0];
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
        
        imgElement.addEventListener('load', () => {
            spinner.style.display = 'none';
            updateHighlightOverlays();
        });
        imgElement.addEventListener('error', () => {
            spinner.style.display = 'none';
            container.innerHTML = `<p style="color:red;">Error loading image tile.</p>`;
        });

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
                        const color = ROI_COLORS[index % ROI_COLORS.length];
                        const colorString = `rgba(${color.r}, ${color.g}, ${color.b}, ${ROI_OPACITY})`;
                        const highlightDiv = document.createElement('div');
                        highlightDiv.style.position = 'absolute';
                        highlightDiv.style.backgroundColor = colorString;
                        highlightDiv.style.boxSizing = 'border-box';
                        highlightDiv.style.pointerEvents = 'none';
                        highlightDiv.style.display = 'none';
                        container.appendChild(highlightDiv);
                        // highlightElements.push(highlightDiv); // Not strictly needed if using roisData.element

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
            // ... (scheduleRender remains the same)
            spinner.style.display = 'block';
            clearTimeout(renderTimeout);
            renderTimeout = setTimeout(renderImage, DEBOUNCE_DELAY);
        }

        function updateHighlightOverlays() {
            // ... (updateHighlightOverlays remains the same)
            if (!imageInfo || viewportWidth === 0 || viewportHeight === 0 ||
                lastRequestedRegion.w <= 0 || lastRequestedRegion.h <= 0 || roisData.length === 0) {
                // Ensure all potential old highlight elements are hidden if no roisData
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
            // ... (renderImage remains the same)
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
            // ... (constrainState remains the same)
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

        function setupEventListeners() {
            // ... (setupEventListeners remains the same)
             // Zoom
             container.addEventListener('wheel', function(event) {
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

            // Pan
            container.addEventListener('mousedown', function(event) {
                if (event.button !== 0) return; 
                isDragging = true;
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;
                container.style.cursor = 'grabbing';
                event.preventDefault();
            });

            container.addEventListener('mousemove', function(event) {
                if (!isDragging) return;
                const dx = event.clientX - lastMouseX;
                const dy = event.clientY - lastMouseY;
                lastMouseX = event.clientX;
                lastMouseY = event.clientY;

                centerXOrig -= dx / currentScale; 
                centerYOrig -= dy / currentScale;
                
                constrainState();
                scheduleRender();
            });

            container.addEventListener('mouseup', function(event) {
                if (event.button !== 0) return;
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                }
            });

            container.addEventListener('mouseleave', function() {
                if (isDragging) {
                    isDragging = false;
                    container.style.cursor = 'grab';
                }
            });
            
            // Resize
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
    } // End of createViewer

    window.HMTIIIFViewer = {
        createViewer: createViewer
    };

})(window);