/* ========================================
   GIS EXPLORER - COMBINED JAVASCRIPT
   ======================================== */

// ========================================
// GLOBAL VARIABLES
// ========================================
let displayMap;
let view;
let currentHighlight;
let uploadedLayers = [];
let currentClassificationLayer = null;


// ========================================
// UTILITY: MODULE LOADER
// ========================================
function loadModule(moduleName) {
  return new Promise((resolve, reject) => {
    require([moduleName], (module) => {
      if (module) {
        resolve(module);
      } else {
        reject(new Error(`Module not found: ${moduleName}`));
      }
    }, (error) => {
      reject(error);
    });
  });
}

// Make loadModule globally available
window.loadModule = loadModule;

// ========================================
// CORE: MAP INITIALIZATION
// ========================================
async function initializeMap() {
  try {
    const [esriConfig, Map, MapView, request, FeatureLayer, Field, Graphic] = await Promise.all([
      loadModule("esri/config"),
      loadModule("esri/Map"),
      loadModule("esri/views/MapView"),
      loadModule("esri/request"),
      loadModule("esri/layers/FeatureLayer"),
      loadModule("esri/layers/support/Field"),
      loadModule("esri/Graphic")
    ]);

    // Store modules globally for use in other functions
    window.esriModules = {
      esriConfig,
      Map,
      MapView,
      request,
      FeatureLayer,
      Field,
      Graphic
    };

    esriConfig.apiKey = "AAPK67a9b2041fcc449d90ab91d6bae4a156HTaBtzlYSKLe8L-zBuIgrSGvxOopzVQEtdwVrlp6RKN9Rrq_y2qkTax7Do1cHqm9";

    displayMap = new Map({
      basemap: "hybrid",
    });

    view = new MapView({
      center: [46.6753, 24.7136],
      container: "displayMap",
      map: displayMap,
      zoom: 11,
      highlightOptions: {
        color: "#14b8a6",
        haloOpacity: 0.9,
        fillOpacity: 0.1,
      },
    });

    view.ui.remove(["zoom"]);

    await view.when();

    // Set up click event for feature information
    setupMapClickHandler();

    return [view, displayMap];
  } catch (error) {
    console.error("Error initializing map:", error);
    throw error;
  }
}

// ========================================
// CORE: MAP CLICK HANDLER
// ========================================
function setupMapClickHandler() {
  view.on("click", async (event) => {
    try {
      // Clear previous highlight first
      clearHighlight();
      
      const response = await view.hitTest(event);
      
      if (response.results.length > 0) {
        let targetResult = null;
        let isUploadedLayer = false;
        
        // First, try to find results from uploaded layers (priority)
        for (const result of response.results) {
          if (result.graphic && result.graphic.geometry && result.layer) {
            if (uploadedLayers.includes(result.layer)) {
              targetResult = result;
              isUploadedLayer = true;
              break;
            }
          }
        }
        
        // If no uploaded layer found, try basemap or other layers
        if (!targetResult) {
          for (const result of response.results) {
            if (result.graphic && result.graphic.geometry && result.layer) {
              // Check if the layer supports querying
              if (result.layer.queryFeatures || result.graphic.attributes) {
                targetResult = result;
                isUploadedLayer = false;
                break;
              }
            }
          }
        }
        
        if (targetResult) {
          let featureWithAttributes = null;
          
          if (isUploadedLayer) {
            // Query uploaded layer for full attributes
            try {
              const query = targetResult.layer.createQuery();
              query.geometry = targetResult.mapPoint;
              query.spatialRelationship = "intersects";
              query.returnGeometry = true;
              query.outFields = ["*"];
              
              const queryResults = await targetResult.layer.queryFeatures(query);
              
              if (queryResults.features.length > 0) {
                featureWithAttributes = queryResults.features[0];
              }
            } catch (queryError) {
              console.warn('Error querying uploaded layer:', queryError);
              // Fallback to the original graphic
              featureWithAttributes = targetResult.graphic;
            }
          } else {
            // Handle basemap or other layers
            if (targetResult.layer.queryFeatures) {
              try {
                const query = targetResult.layer.createQuery();
                query.geometry = targetResult.mapPoint;
                query.spatialRelationship = "intersects";
                query.returnGeometry = true;
                query.outFields = ["*"];
                
                const queryResults = await targetResult.layer.queryFeatures(query);
                
                if (queryResults.features.length > 0) {
                  featureWithAttributes = queryResults.features[0];
                } else {
                  // Use the original graphic if no query results
                  featureWithAttributes = targetResult.graphic;
                }
              } catch (queryError) {
                console.warn('Error querying basemap layer:', queryError);
                // Fallback to the original graphic
                featureWithAttributes = targetResult.graphic;
              }
            } else {
              // Use the graphic directly if no query capability
              featureWithAttributes = targetResult.graphic;
            }
          }
          
          if (featureWithAttributes) {
            // Create highlight graphic
            const highlightSymbol = createHighlightSymbol(featureWithAttributes.geometry.type);
            
            currentHighlight = new window.esriModules.Graphic({
              geometry: featureWithAttributes.geometry,
              symbol: highlightSymbol
            });
            
            // Add highlight to view
            view.graphics.add(currentHighlight);
            
            // Show feature information panel
            showFeatureInfo(featureWithAttributes);
          } else {
            hideFeaturePanel();
          }
        } else {
          // No valid feature found
          hideFeaturePanel();
        }
      } else {
        // No features clicked
        hideFeaturePanel();
      }
    } catch (error) {
      console.error("Error handling map click:", error);
      hideFeaturePanel();
    }
  });
}

// Clear highlight function
function clearHighlight() {
  if (currentHighlight) {
    view.graphics.remove(currentHighlight);
    currentHighlight = null;
  }
}

// Create highlight symbol based on geometry type
function createHighlightSymbol(geometryType) {
  const highlightColor = "#14b8a6";
  
  switch (geometryType) {
    case "point":
      return {
        type: "simple-marker",
        color: "rgba(20, 184, 166, 0.8)",
        size: 12,
        outline: {
          color: highlightColor,
          width: 3
        }
      };
    case "polyline":
      return {
        type: "simple-line",
        color: highlightColor,
        width: 4
      };
    case "polygon":
    default:
      return {
        type: "simple-fill",
        color: "rgba(20, 184, 166, 0.3)",
        outline: {
          color: highlightColor,
          width: 3
        }
      };
  }
}

// ========================================
// WIDGET: FEATURE PANEL
// ========================================
function showFeatureInfo(graphic) {
  const featurePanel = document.getElementById('featurePanel');
  const featureContent = document.getElementById('featureContent');
  
  // Clear previous content
  featureContent.innerHTML = '';
  
  // Get feature attributes
  const attributes = graphic.attributes;
  
  if (attributes && Object.keys(attributes).length > 0) {
    Object.entries(attributes).forEach(([key, value]) => {
      const featureItem = document.createElement('div');
      featureItem.className = 'feature-item fade-in';
      featureItem.innerHTML = `
        <div class="feature-label">${key.replace(/_/g, ' ')}</div>
        <div class="feature-value">${formatValue(value)}</div>
      `;
      featureContent.appendChild(featureItem);
    });
  } else {
    featureContent.innerHTML = '<p style="color: #6b7280; text-align: center;">No attribute data available for this feature.</p>';
  }
  
  // Show the panel
  featurePanel.classList.remove('hidden');
  setTimeout(() => {
    featurePanel.classList.add('show');
  }, 10);
}

function hideFeaturePanel() {
  const featurePanel = document.getElementById('featurePanel');
  if (featurePanel.classList.contains('show')) {
    featurePanel.classList.remove('show');
    // Clear highlight when hiding panel
    clearHighlight();
    setTimeout(() => {
      featurePanel.classList.add('hidden');
    }, 400);
  }
}

// Format attribute values for display
function formatValue(value) {
  // Handle null and undefined
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  
  // Handle empty string or just spaces
  if (typeof value === 'string' && value.trim() === '') {
    return '(empty)';
  }
  
  // Handle numbers
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  
  // Handle long strings
  if (typeof value === 'string' && value.length > 50) {
    return value.substring(0, 50) + '...';
  }
  
  return value || '(no value)';
}

function initializeFeaturePanel() {
  const closeFeature = document.getElementById('closeFeature');
  
  closeFeature.addEventListener('click', () => {
    const featurePanel = document.getElementById('featurePanel');
    featurePanel.classList.remove('show');
    
    // Clear highlight when closing panel
    clearHighlight();
    
    setTimeout(() => {
      featurePanel.classList.add('hidden');
    }, 400);
  });
}

// ========================================
// WIDGET: UPLOAD
// ========================================
function initializeUpload() {
  const uploadToggle = document.getElementById('uploadToggle');
  const uploadPanel = document.getElementById('uploadPanel');
  const closeUpload = document.getElementById('closeUpload');

  // Shapefile elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  // GeoJSON elements
  const dropZoneGeoJSON = document.getElementById('dropZoneGeoJSON');
  const fileInputGeoJSON = document.getElementById('fileInputGeoJSON');

  // Tab elements
  const uploadTabs = document.querySelectorAll('.upload-tab');
  const tabContents = document.querySelectorAll('.upload-tab-content');

  // Toggle upload panel
  uploadToggle.addEventListener('click', () => {
    uploadPanel.classList.remove('hidden');
    setTimeout(() => {
      uploadPanel.classList.add('show');
    }, 10);
  });

  // Close upload panel
  closeUpload.addEventListener('click', () => {
    uploadPanel.classList.remove('show');
    setTimeout(() => {
      uploadPanel.classList.add('hidden');
    }, 400);
  });

  // Tab switching functionality
  uploadTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabType = tab.getAttribute('data-tab');
      
      // Remove active class from all tabs and contents
      uploadTabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked tab
      tab.classList.add('active');
      
      // Show corresponding content
      if (tabType === 'shapefile') {
        document.getElementById('shapefileTab').classList.add('active');
      } else if (tabType === 'geojson') {
        document.getElementById('geojsonTab').classList.add('active');
      }
    });
  });

  // Shapefile drop zone functionality
  setupDropZone(dropZone, fileInput, 'shapefile');

  // GeoJSON drop zone functionality
  setupDropZone(dropZoneGeoJSON, fileInputGeoJSON, 'geojson');
}

// Setup drop zone functionality (helper function)
function setupDropZone(dropZone, fileInput, fileType) {
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0], fileType);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileUpload(e.target.files[0], fileType);
    }
  });
}

// Handle file upload
async function handleFileUpload(file, fileType = 'shapefile') {
  const uploadStatus = document.getElementById('uploadStatus');
  const loadingOverlay = document.getElementById('loadingOverlay');
  
  try {
    // Validate file based on type
    if (fileType === 'shapefile') {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        showUploadStatus('Please select a ZIP file containing shapefile data.', 'error');
        return;
      }
    } else if (fileType === 'geojson') {
      if (!file.name.toLowerCase().endsWith('.json') && !file.name.toLowerCase().endsWith('.geojson')) {
        showUploadStatus('Please select a .json or .geojson file.', 'error');
        return;
      }
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      showUploadStatus('File size exceeds 50MB limit.', 'error');
      return;
    }

    // Show loading
    showUploadStatus(`Processing ${fileType}...`, 'loading');
    loadingOverlay.classList.remove('hidden');
    setTimeout(() => {
      loadingOverlay.classList.add('show');
    }, 10);

    // Process the file based on type
    if (fileType === 'shapefile') {
      await generateFeatureCollection(file);
    } else if (fileType === 'geojson') {
      await processGeoJSON(file);
    }

  } catch (error) {
    console.error('Upload error:', error);
    showUploadStatus(`Error: ${error.message}`, 'error');
  } finally {
    // Hide loading
    loadingOverlay.classList.remove('show');
    setTimeout(() => {
      loadingOverlay.classList.add('hidden');
    }, 300);
  }
}

// Show upload status message
function showUploadStatus(message, type) {
  const uploadStatus = document.getElementById('uploadStatus');
  uploadStatus.textContent = message;
  uploadStatus.className = `upload-status ${type}`;
}

// Process GeoJSON file
async function processGeoJSON(file) {
  try {
    // Read the file as text
    const fileText = await readFileAsText(file);
    
    // Parse the GeoJSON
    let geoJSONData;
    try {
      geoJSONData = JSON.parse(fileText);
    } catch (parseError) {
      throw new Error('Invalid JSON format. Please check your GeoJSON file.');
    }

    // Clean the GeoJSON data - remove unsupported CRS
    if (geoJSONData.crs) {
      console.log('Removing unsupported CRS from GeoJSON:', geoJSONData.crs);
      delete geoJSONData.crs;
    }

    // Also clean CRS from individual features if they exist
    if (geoJSONData.features) {
      geoJSONData.features.forEach(feature => {
        if (feature.crs) {
          delete feature.crs;
        }
      });
    }

    // Validate GeoJSON structure
    if (!geoJSONData.type || (geoJSONData.type !== 'FeatureCollection' && geoJSONData.type !== 'Feature')) {
      throw new Error('Invalid GeoJSON. Must be a FeatureCollection or Feature.');
    }

    // Convert single Feature to FeatureCollection
    if (geoJSONData.type === 'Feature') {
      geoJSONData = {
        type: 'FeatureCollection',
        features: [geoJSONData]
      };
    }

    // Validate features
    if (!geoJSONData.features || geoJSONData.features.length === 0) {
      throw new Error('GeoJSON file contains no features.');
    }

    const layerName = file.name.split(".")[0];
    showUploadStatus(`Successfully loaded: ${layerName}`, 'success');
    
    // Add to map
    await addGeoJSONToMap(geoJSONData, layerName);
    
    // Close upload panel after successful upload
    setTimeout(() => {
      document.getElementById('uploadPanel').classList.remove('show');
      setTimeout(() => {
        document.getElementById('uploadPanel').classList.add('hidden');
      }, 400);
    }, 2000);

  } catch (error) {
    console.error("Error processing GeoJSON:", error);
    throw error;
  }
}

// Helper function to read file as text
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = (error) => reject(error);
    reader.readAsText(file);
  });
}

// Generate feature collection from shapefile
async function generateFeatureCollection(file) {
  const { request, FeatureLayer, Field, Graphic } = window.esriModules;
  const portalUrl = "https://www.arcgis.com";

  try {
    let name = file.name.split(".")[0];
    
    const params = {
      name: name,
      targetSR: view.spatialReference,
      maxRecordCount: 1000,
      enforceInputFileSizeLimit: true,
      enforceOutputJsonSizeLimit: true,
      generalize: true,
      maxAllowableOffset: 10,
      reducePrecision: true,
      numberOfDigitsAfterDecimal: 0,
    };

    const formData = new FormData();
    formData.append('file', file);
    formData.append('filetype', 'shapefile');
    formData.append('publishParameters', JSON.stringify(params));
    formData.append('f', 'json');

    const response = await request(portalUrl + "/sharing/rest/content/features/generate", {
      method: 'post',
      body: formData,
      responseType: "json",
    });

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    const layerName = response.data.featureCollection.layers[0].layerDefinition.name;
    showUploadStatus(`Successfully loaded: ${layerName}`, 'success');
    
    // Add to map
    await addShapefileToMap(response.data.featureCollection);
    
    // Close upload panel after successful upload
    setTimeout(() => {
      document.getElementById('uploadPanel').classList.remove('show');
      setTimeout(() => {
        document.getElementById('uploadPanel').classList.add('hidden');
      }, 400);
    }, 2000);

  } catch (error) {
    console.error("Error processing shapefile:", error);
    throw error;
  }
}

// Add shapefile to map
async function addShapefileToMap(featureCollection) {
  const { FeatureLayer, Field, Graphic } = window.esriModules;
  
  try {
    let sourceGraphics = [];
    const layers = featureCollection.layers.map((layer, index) => {
      const graphics = layer.featureSet.features.map((feature) => {
        const graphic = Graphic.fromJSON(feature);
        
        // Preserve all original attributes
        if (feature.attributes) {
          // Create a deep copy of attributes to ensure they're preserved
          const preservedAttributes = {};
          Object.keys(feature.attributes).forEach(key => {
            preservedAttributes[key] = feature.attributes[key];
          });
          graphic.attributes = preservedAttributes;
        }
        
        return graphic;
      });
      
      sourceGraphics = sourceGraphics.concat(graphics);

      const featureLayer = new FeatureLayer({
        objectIdField: "FID",
        source: graphics,
        fields: layer.layerDefinition.fields.map((field) => {
          return Field.fromJSON(field);
        }),
        renderer: createCustomRenderer(layer.layerDefinition.geometryType),
        title: layer.layerDefinition.name || `Uploaded Layer ${index + 1}`,
        popupEnabled: false, // Disable default popup to use our custom panel
        // Ensure we can query all fields
        outFields: ["*"]
      });
      
      return featureLayer;
    });

    // Add layers to map
    displayMap.addMany(layers);
    uploadedLayers.push(...layers);
    
    // Zoom to extent
    if (sourceGraphics.length > 0) {
      await view.goTo(sourceGraphics, {
        duration: 2000,
        easing: "ease-in-out"
      });
    }

  } catch (error) {
    console.error("Error adding shapefile to map:", error);
    throw error;
  }
}

// Add GeoJSON to map
async function addGeoJSONToMap(geoJSONData, layerName) {
  const { FeatureLayer, Field, Graphic } = window.esriModules;
  
  try {
    // Convert GeoJSON features to Esri Graphics manually
    const graphics = geoJSONData.features.map((feature, index) => {
      // Properly convert GeoJSON geometry to ArcGIS format
      let geometry = null;

      if (feature.geometry) {
        switch (feature.geometry.type.toLowerCase()) {
          case 'point':
            geometry = {
              type: "point",
              longitude: feature.geometry.coordinates[0],
              latitude: feature.geometry.coordinates[1],
              spatialReference: { wkid: 4326 }
            };
            break;
            
          case 'linestring':
            geometry = {
              type: "polyline",
              paths: [feature.geometry.coordinates],
              spatialReference: { wkid: 4326 }
            };
            break;
            
          case 'polygon':
            geometry = {
              type: "polygon",
              rings: feature.geometry.coordinates,
              spatialReference: { wkid: 4326 }
            };
            break;
            
          case 'multipoint':
            geometry = {
              type: "multipoint",
              points: feature.geometry.coordinates,
              spatialReference: { wkid: 4326 }
            };
            break;
            
          case 'multilinestring':
            geometry = {
              type: "polyline",
              paths: feature.geometry.coordinates,
              spatialReference: { wkid: 4326 }
            };
            break;
            
          case 'multipolygon':
            // Flatten the multipolygon rings
            const allRings = [];
            feature.geometry.coordinates.forEach(polygon => {
              polygon.forEach(ring => {
                allRings.push(ring);
              });
            });
            geometry = {
              type: "polygon",
              rings: allRings,
              spatialReference: { wkid: 4326 }
            };
            break;
            
          default:
            console.warn('Unsupported geometry type:', feature.geometry.type);
            geometry = null;
        }
      }
      
      // Create attributes
      const attributes = {
        OBJECTID: index + 1,
        FID: index + 1,
        ...feature.properties
      };
      
      return new Graphic({
        geometry: geometry,
        attributes: attributes
      });
    }).filter(graphic => graphic !== null && graphic.geometry !== null);
    
    // Create fields from the first feature
    const fields = [
      new Field({ name: "OBJECTID", alias: "OBJECTID", type: "oid" }),
      new Field({ name: "FID", alias: "FID", type: "integer" })
    ];
    
    // Add fields from properties with better type detection
    if (geoJSONData.features[0] && geoJSONData.features[0].properties) {
      Object.keys(geoJSONData.features[0].properties).forEach(key => {
        let fieldType = "string"; // default
        
        // Check all features to determine the best field type
        let hasNumber = false;
        let hasDecimal = false;
        
        geoJSONData.features.forEach(feature => {
          const value = feature.properties[key];
          if (typeof value === 'number' && !isNaN(value)) {
            hasNumber = true;
            if (!Number.isInteger(value)) {
              hasDecimal = true;
            }
          }
        });
        
        // Determine field type
        if (hasNumber) {
          fieldType = hasDecimal ? "double" : "integer";
        }
        
        fields.push(new Field({
          name: key,
          alias: key.replace(/_/g, ' '),
          type: fieldType
        }));
      });
    }
    
    // Determine geometry type
    const firstGeometry = geoJSONData.features[0]?.geometry;
    let geometryType = "polygon"; // default
    
    if (firstGeometry) {
      switch (firstGeometry.type.toLowerCase()) {
        case 'point':
        case 'multipoint':
          geometryType = "point";
          break;
        case 'linestring':
        case 'multilinestring':
          geometryType = "polyline";
          break;
        case 'polygon':
        case 'multipolygon':
          geometryType = "polygon";
          break;
      }
    }
    
    // Create FeatureLayer
    const featureLayer = new FeatureLayer({
      source: graphics,
      fields: fields,
      objectIdField: "OBJECTID",
      geometryType: geometryType,
      title: layerName || 'GeoJSON Layer',
      popupEnabled: false,
      renderer: createCustomRenderer(`esriGeometry${geometryType.charAt(0).toUpperCase() + geometryType.slice(1)}`),
      spatialReference: { wkid: 4326 }
    });
    



    // Add layer to map
    displayMap.add(featureLayer);
    uploadedLayers.push(featureLayer);
    
    // Zoom to extent after layer loads
    try {
      await featureLayer.when();
      
      if (featureLayer.fullExtent) {
        await view.goTo(featureLayer.fullExtent, {
          duration: 2000,
          easing: "ease-in-out"
        });
      } else if (graphics.length > 0) {
        // Fallback to graphics extent
        await view.goTo(graphics, {
          duration: 2000,
          easing: "ease-in-out"
        });
      }
    } catch (zoomError) {
      console.warn('Could not zoom to layer extent:', zoomError);
    }

  } catch (error) {
    console.error("Error adding GeoJSON to map:", error);
    throw error;
  }
}

// Create custom renderer based on geometry type
function createCustomRenderer(geometryType) {
  const colors = [
    [59, 130, 246], // Blue
    [20, 184, 166], // Teal  
    [249, 115, 22], // Orange
    [139, 92, 246], // Purple
    [34, 197, 94]   // Green
  ];
  
  const colorIndex = uploadedLayers.length % colors.length;
  const color = colors[colorIndex];
  
  if (geometryType === "esriGeometryPoint") {
    return {
      type: "simple",
      symbol: {
        type: "simple-marker",
        color: color,
        size: 8,
        outline: {
          color: [255, 255, 255],
          width: 2
        }
      }
    };
  } else if (geometryType === "esriGeometryPolyline") {
    return {
      type: "simple",
      symbol: {
        type: "simple-line",
        color: color,
        width: 3
      }
    };
  } else {
    return {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: [...color, 0.3],
        outline: {
          color: color,
          width: 2
        }
      }
    };
  }
}

// ========================================
// WIDGET: COORDINATES
// ========================================
function initializeCoordinatesWidget() {
  const coordinatesWidget = document.getElementById('coordinatesWidget');
  const coordinatesText = coordinatesWidget.querySelector('.coordinates-text');

  // Update coordinates on pointer move
  view.on('pointer-move', (event) => {
    const mapPoint = view.toMap({ x: event.x, y: event.y });

    if (mapPoint) {
      updateCoordinates(mapPoint.latitude, mapPoint.longitude);
    }
  });

  // Also update on map extent changes
  setupCenterWatch();

  function updateCoordinates(lat, lon) {
    const text = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    coordinatesText.textContent = text;
  }

  async function setupCenterWatch() {
    try {
      const reactiveUtils = await window.loadModule("esri/core/reactiveUtils");
      
      reactiveUtils.watch(
        () => view.center,
        (center) => {
          if (center) {
            updateCoordinates(center.latitude, center.longitude);
          }
        }
      );
    } catch (error) {
      console.warn('Could not load reactiveUtils, falling back to basic coordinates');
    }
  }
}

// ========================================
// WIDGET: CUSTOM WIDGETS
// ========================================
function initializeCustomWidgets() {
  const layerListToggle = document.getElementById('layerListToggle');
  const customLayerList = document.getElementById('customLayerList');
  const closeLayerList = document.getElementById('closeLayerList');
  const fullscreenToggle = document.getElementById('fullscreenToggle');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const homeBtn = document.getElementById('homeBtn');

  // Layer List Toggle
  layerListToggle.addEventListener('click', () => {
    layerListToggle.classList.toggle('active');
    customLayerList.classList.toggle('show');
  });

  // Close Layer List
  closeLayerList.addEventListener('click', () => {
    layerListToggle.classList.remove('active');
    customLayerList.classList.remove('show');
  });

  // Fullscreen Toggle
  fullscreenToggle.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      fullscreenToggle.classList.add('active');
    } else {
      document.exitFullscreen();
      fullscreenToggle.classList.remove('active');
    }
  });

  // Zoom In
  zoomInBtn.addEventListener('click', () => {
    view.zoom += 1;
  });

  // Zoom Out
  zoomOutBtn.addEventListener('click', () => {
    view.zoom -= 1;
  });

  // Home Button - go back to initial extent
  const initialCenter = [46.6753, 24.7136]; // Your initial center
  const initialZoom = 11; // Your initial zoom

  homeBtn.addEventListener('click', () => {
    view.goTo({
      center: initialCenter,
      zoom: initialZoom
    }, {
      duration: 1500,
      easing: "ease-in-out"
    });
    
    homeBtn.classList.add('active');
    setTimeout(() => {
      homeBtn.classList.remove('active');
    }, 1500);
  });

  // Create custom basemap toggle
  const customBasemapBtn = document.createElement('button');
  customBasemapBtn.className = 'custom-widget';
  customBasemapBtn.style.cssText = `
    position: absolute;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
  `;
  customBasemapBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>
  `;
  customBasemapBtn.title = 'تبديل خريطة الأساس';

  let isImagery = false;
  customBasemapBtn.addEventListener('click', () => {
    if (isImagery) {
      displayMap.basemap = 'hybrid';
      isImagery = false;
    } else {
      displayMap.basemap = 'topo-vector';
      isImagery = true;
    }
    customBasemapBtn.classList.toggle('active', isImagery);
  });

  document.body.appendChild(customBasemapBtn);

  // Update layer list when layers change
  displayMap.allLayers.on("change", updateLayerList);
  updateLayerList();
}

// ========================================
// WIDGET: LAYER LIST
// ========================================
function updateLayerList() {
  const layerListContent = document.getElementById('layerListContent');
  layerListContent.innerHTML = '';

  displayMap.allLayers.forEach((layer, index) => {
    if (layer.type === 'feature' && layer.source) {
      const layerItem = document.createElement('div');
      layerItem.className = 'layer-item';
      
      // Get the actual renderer color from the layer
      let color = '#3b82f6'; // default color
      
      if (layer.renderer && layer.renderer.symbol) {
        const symbol = layer.renderer.symbol;
        if (symbol.color) {
          // Convert color array to hex or use existing color
          if (Array.isArray(symbol.color)) {
            color = `rgb(${symbol.color[0]}, ${symbol.color[1]}, ${symbol.color[2]})`;
          } else if (symbol.color.toHex) {
            color = symbol.color.toHex();
          } else if (typeof symbol.color === 'string') {
            color = symbol.color;
          }
        } else if (symbol.outline && symbol.outline.color) {
          // For polygon symbols, use outline color
          const outlineColor = symbol.outline.color;
          if (Array.isArray(outlineColor)) {
            color = `rgb(${outlineColor[0]}, ${outlineColor[1]}, ${outlineColor[2]})`;
          }
        }
      }
      
      layerItem.innerHTML = `
        <div class="layer-info">
          <div class="layer-color" style="background-color: ${color}"></div>
          <div class="layer-name">${layer.title || 'Untitled Layer'}</div>
        </div>
        <div class="layer-controls">
          <button class="classify-layer-btn" title="تصنيف الطبقة" data-layer-id="${layer.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"></line>
              <line x1="4" y1="12" x2="14" y2="12"></line>
              <line x1="4" y1="18" x2="10" y2="18"></line>
            </svg>
          </button>
          <button class="zoom-to-layer-btn" title="تكبير للطبقة" data-layer-id="${layer.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 9 3 3 9 3" />
              <polyline points="15 3 21 3 21 9" />
              <polyline points="21 15 21 21 15 21" />
              <polyline points="9 21 3 21 3 15" />
            </svg>
          </button>
          <div class="toggle-switch ${layer.visible ? 'active' : ''}" data-layer-id="${layer.id}"></div>
        </div>
      `;
      
      layerListContent.appendChild(layerItem);
      
      // Toggle layer visibility
      const toggle = layerItem.querySelector('.toggle-switch');
      toggle.addEventListener('click', () => {
        layer.visible = !layer.visible;
        toggle.classList.toggle('active', layer.visible);
      });

      // Zoom to layer extent
      const zoomBtn = layerItem.querySelector('.zoom-to-layer-btn');
      zoomBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        try {
          // Add loading state
          zoomBtn.style.opacity = '0.5';
          zoomBtn.style.pointerEvents = 'none';
          
          if (layer.fullExtent) {
            await view.goTo(layer.fullExtent, {
              duration: 1500,
              easing: "ease-in-out"
            });
          } else {
            console.warn('Layer does not have a fullExtent:', layer.title);
            
            // Fallback: try to query features and get their extent
            if (layer.queryExtent) {
              const extentResult = await layer.queryExtent();
              if (extentResult.extent) {
                await view.goTo(extentResult.extent, {
                  duration: 1500,
                  easing: "ease-in-out"
                });
              }
            }
          }
        } catch (error) {
          console.error('Error zooming to layer extent:', error);
        } finally {
          // Remove loading state
          zoomBtn.style.opacity = '1';
          zoomBtn.style.pointerEvents = 'auto';
        }
      });

      // Classification button
      const classifyBtn = layerItem.querySelector('.classify-layer-btn');
      classifyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openClassificationPanel(layer);
      });
    }
  });
}

// ========================================
// WIDGET: CLASSIFICATION
// ========================================
function initializeClassificationPanel() {
  const closeClassification = document.getElementById('closeClassification');
  const applyClassification = document.getElementById('applyClassification');
  const resetRenderer = document.getElementById('resetRenderer');
  const fieldSelect = document.getElementById('fieldSelect');
  
  // Field selection change
  fieldSelect.addEventListener('change', async () => {
    const fieldName = fieldSelect.value;
    
    if (fieldName && currentClassificationLayer) {
      const stats = await analyzeFieldValues(currentClassificationLayer, fieldName);
      showFieldStatistics(stats);
    } else {
      document.getElementById('fieldInfo').style.display = 'none';
    }
  });
  
  // Close panel
  closeClassification.addEventListener('click', () => {
    document.getElementById('classificationPanel').classList.add('hidden');
    document.getElementById('mapLegend').classList.add('hidden');
    currentClassificationLayer = null;
  });
  
  // Apply classification 
  applyClassification.addEventListener('click', async () => {
    await applyFieldClassification();
  });
  
  // Reset renderer
  resetRenderer.addEventListener('click', () => {
    resetLayerRenderer();
  });
}

// Open classification panel
function openClassificationPanel(layer) {
  currentClassificationLayer = layer;
  
  const classificationPanel = document.getElementById('classificationPanel');
  const fieldSelect = document.getElementById('fieldSelect');
  const fieldInfo = document.getElementById('fieldInfo');
  
  // Clear and populate field options
  fieldSelect.innerHTML = '<option value="">-- اختر حقل --</option>';
  
  if (layer.fields && layer.fields.length > 0) {
    layer.fields.forEach(field => {
      // Only show relevant fields for classification
      if (field.type === 'double' || field.type === 'integer' || field.type === 'string') {
        const option = document.createElement('option');
        option.value = field.name;
        option.textContent = field.alias || field.name;
        fieldSelect.appendChild(option);
      }
    });
  }
  
  // Hide field info initially
  fieldInfo.style.display = 'none';
  
  // Show the panel
  classificationPanel.classList.remove('hidden');
}

// Analyze field values and show statistics
async function analyzeFieldValues(layer, fieldName) {
  try {
    const query = layer.createQuery();
    query.outFields = [fieldName];
    query.where = "1=1";
    query.returnGeometry = false;
    
    const results = await layer.queryFeatures(query);
    
    if (results.features.length === 0) {
      return null;
    }
    
    // Extract values
    const values = results.features.map(feature => feature.attributes[fieldName]);
    
    // Remove null/undefined values
    const validValues = values.filter(value => value !== null && value !== undefined && value !== '');
    
    // Get unique values with counts
    const valueCount = {};
    validValues.forEach(value => {
      const key = String(value);
      valueCount[key] = (valueCount[key] || 0) + 1;
    });
    
    // Sort by count (descending)
    const sortedValues = Object.entries(valueCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20); // Limit to top 20 values
    
    const totalFeatures = results.features.length;
    const validCount = validValues.length;
    const uniqueCount = Object.keys(valueCount).length;
    
    return {
      totalFeatures,
      validCount,
      uniqueCount,
      sortedValues,
      fieldName
    };
    
  } catch (error) {
    console.error('Error analyzing field values:', error);
    return null;
  }
}

// Show field statistics
function showFieldStatistics(stats) {
  const fieldInfo = document.getElementById('fieldInfo');
  const statsContent = fieldInfo.querySelector('.stats-content');
  
  if (!stats) {
    fieldInfo.style.display = 'none';
    return;
  }
  
  let statsHTML = `
    <div style="margin-bottom: 8px;">
      <strong>العدد الإجمالي:</strong> ${stats.totalFeatures}<br>
      <strong>القيم الصالحة:</strong> ${stats.validCount}<br>
      <strong>القيم الفريدة:</strong> ${stats.uniqueCount}
    </div>
  `;
  
  if (stats.uniqueCount <= 20) {
    statsHTML += '<div style="margin-top: 8px;"><strong>أعلى القيم:</strong></div>';
    statsHTML += '<div style="max-height: 150px; overflow-y: auto; margin-top: 4px;">';
    
    stats.sortedValues.forEach(([value, count]) => {
      const percentage = ((count / stats.validCount) * 100).toFixed(1);
      statsHTML += `
        <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px solid #e5e7eb;">
          <span style="word-break: break-word; max-width: 60%;">${value}</span>
          <span style="color: #6b7280;">${count} (${percentage}%)</span>
        </div>
      `;
    });
    
    statsHTML += '</div>';
  } else {
    statsHTML += '<div style="margin-top: 8px; color: #ef4444; font-size: 12px;">تحذير: عدد كبير من القيم الفريدة. سيتم عرض أعلى 20 قيمة فقط.</div>';
  }
  
  statsContent.innerHTML = statsHTML;
  fieldInfo.style.display = 'block';
}

// Generate colors for unique values
function generateColors(count) {
  const colors = [
    [59, 130, 246],   // Blue
    [34, 197, 94],    // Green  
    [249, 115, 22],   // Orange
    [139, 92, 246],   // Purple
    [236, 72, 153],   // Pink
    [20, 184, 166],   // Teal
    [245, 158, 11],   // Amber
    [239, 68, 68],    // Red
    [156, 163, 175],  // Gray
    [16, 185, 129],   // Emerald
    [124, 58, 237],   // Violet
    [217, 70, 239],   // Fuchsia
    [14, 165, 233],   // Sky
    [34, 197, 94],    // Lime
    [251, 146, 60],   // Orange
    [244, 63, 94],    // Rose
    [168, 85, 247],   // Purple
    [59, 130, 246],   // Indigo
    [16, 185, 129],   // Teal
    [245, 158, 11]    // Yellow
  ];
  
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(colors[i % colors.length]);
  }
  return result;
}

// Apply field classification
async function applyFieldClassification() {
  const fieldSelect = document.getElementById('fieldSelect');
  const fieldName = fieldSelect.value;
  
  if (!fieldName || !currentClassificationLayer) {
    alert('يرجى اختيار حقل للتصنيف');
    return;
  }
  
  try {
    // Show loading
    const applyBtn = document.getElementById('applyClassification');
    applyBtn.textContent = 'جاري التطبيق...';
    applyBtn.disabled = true;
    
    // Get field statistics
    const stats = await analyzeFieldValues(currentClassificationLayer, fieldName);
    
    if (!stats || stats.uniqueCount === 0) {
      alert('لا توجد قيم صالحة في الحقل المحدد');
      return;
    }
    
    // Generate colors for unique values
    const colors = generateColors(stats.sortedValues.length);
    
    // Get geometry type
    const layerGeometryType = currentClassificationLayer.geometryType;
    
    // Create unique value infos for renderer
    const uniqueValueInfos = stats.sortedValues.map(([value, count], index) => {
      const color = colors[index];
      
      // Create symbol based on geometry type
      let symbol;
      
      if (layerGeometryType === 'point') {
        symbol = {
          type: "simple-marker",
          color: color,
          size: 8,
          outline: {
            color: [255, 255, 255],
            width: 1
          }
        };
      } else if (layerGeometryType === 'polyline') {
        symbol = {
          type: "simple-line",
          color: color,
          width: 3
        };
      } else { // polygon
        symbol = {
          type: "simple-fill",
          color: [...color, 0.7],
          outline: {
            color: color,
            width: 2
          }
        };
      }
      
      return {
        value: value,
        symbol: symbol,
        label: `${value} (${count})`
      };
    });
    
    // Create the renderer
    const renderer = {
      type: "unique-value",
      field: fieldName,
      uniqueValueInfos: uniqueValueInfos,
      defaultSymbol: createDefaultSymbol(layerGeometryType),
      defaultLabel: "أخرى"
    };
    
    // Apply the renderer to the layer
    currentClassificationLayer.renderer = renderer;
    
    // Create and show legend
    createMapLegend(stats, colors, fieldName);
    
    // Close classification panel
    document.getElementById('classificationPanel').classList.add('hidden');
    
  } catch (error) {
    console.error('Error applying classification:', error);
    alert('حدث خطأ أثناء تطبيق التصنيف');
  } finally {
    // Reset button
    const applyBtn = document.getElementById('applyClassification');
    applyBtn.textContent = 'تطبيق التصنيف';
    applyBtn.disabled = false;
  }
}

// Create default symbol based on geometry type
function createDefaultSymbol(geometryType) {
  if (geometryType === 'point') {
    return {
      type: "simple-marker",
      color: [128, 128, 128, 0.8],
      size: 6,
      outline: {
        color: [255, 255, 255],
        width: 1
      }
    };
  } else if (geometryType === 'polyline') {
    return {
      type: "simple-line",
      color: [128, 128, 128, 0.8],
      width: 2
    };
  } else { // polygon
    return {
      type: "simple-fill",
      color: [128, 128, 128, 0.5],
      outline: {
        color: [128, 128, 128],
        width: 1
      }
    };
  }
}

// Reset layer renderer
function resetLayerRenderer() {
  if (!currentClassificationLayer) {
    return;
  }
  
  try {
    // Create default renderer based on geometry type
    const geometryType = currentClassificationLayer.geometryType;
    
    // Find the original color from uploaded layers
    const layerIndex = uploadedLayers.indexOf(currentClassificationLayer);
    const colors = [
      [59, 130, 246], // Blue
      [20, 184, 166], // Teal  
      [249, 115, 22], // Orange
      [139, 92, 246], // Purple
      [34, 197, 94]   // Green
    ];
    const color = colors[layerIndex % colors.length];
    
    let defaultSymbol;
    
    if (geometryType === 'point') {
      defaultSymbol = {
        type: "simple-marker",
        color: color,
        size: 8,
        outline: {
          color: [255, 255, 255],
          width: 2
        }
      };
    } else if (geometryType === 'polyline') {
      defaultSymbol = {
        type: "simple-line",
        color: color,
        width: 3
      };
    } else { // polygon
      defaultSymbol = {
        type: "simple-fill",
        color: [...color, 0.3],
        outline: {
          color: color,
          width: 2
        }
      };
    }
    
    const defaultRenderer = {
      type: "simple",
      symbol: defaultSymbol
    };
    
    // Apply default renderer
    currentClassificationLayer.renderer = defaultRenderer;
    
    // Hide legend
    document.getElementById('mapLegend').classList.add('hidden');
    
    // Close classification panel
    document.getElementById('classificationPanel').classList.add('hidden');
    
  } catch (error) {
    console.error('Error resetting renderer:', error);
    alert('حدث خطأ أثناء إعادة تعيين التصنيف');
  }
}

// Create map legend
function createMapLegend(stats, colors, fieldName) {
  const mapLegend = document.getElementById('mapLegend');
  const legendTitle = mapLegend.querySelector('.legend-title');
  const legendItems = mapLegend.querySelector('.legend-items');
  
  // Set legend title
  const field = currentClassificationLayer.fields.find(f => f.name === fieldName);
  const fieldLabel = field ? (field.alias || field.name) : fieldName;
  legendTitle.textContent = `التصنيف حسب: ${fieldLabel}`;
  
  // Clear previous items
  legendItems.innerHTML = '';
  
  // Add legend items
  stats.sortedValues.forEach(([value, count], index) => {
    const color = colors[index];
    const percentage = ((count / stats.validCount) * 100).toFixed(1);
    
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-color" style="background-color: rgb(${color[0]}, ${color[1]}, ${color[2]})"></div>
      <div class="legend-label">${value}</div>
      <div class="legend-count">${count} (${percentage}%)</div>
    `;
    
    legendItems.appendChild(legendItem);
  });
  
  // Show legend
  mapLegend.classList.remove('hidden');
}


// ========================================
// DATA: STATIC GEOJSON LAYER
// ========================================
async function loadStaticGeoJSONLayer() {
  console.log("🟢 Starting to load static GeoJSON layer...");
  try {
    const geoJSONData = {
      "type": "FeatureCollection",
      "features": [
        {
          "type": "Feature",
          "id": 1,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.704717642135527,
                  24.781922884877851
                ],
                [
                  46.704569748620649,
                  24.782218521690389
                ],
                [
                  46.704119992005332,
                  24.782030993904847
                ],
                [
                  46.704267886421341,
                  24.781735357484546
                ],
                [
                  46.704717642135527,
                  24.781922884877851
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 1,
            "رقم_العقار": "6",
            "رقم_القطعة": "مسجد",
            "الاسم": "وزارة الشئون الإسلامية والأوقاف",
            "رقم_الصك": "",
            "تاريخ_الصك": "",
            "رقم_السجل": null,
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": null,
            "الاستخدام": "مسجد ",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 1800,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 873,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 172.00012623383759,
            "Shape_Area": 1800.0028538290646
          }
        },
        {
          "type": "Feature",
          "id": 2,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.704184300963497,
                  24.782206683434293
                ],
                [
                  46.704508126210811,
                  24.782341703809799
                ],
                [
                  46.704204120141782,
                  24.782949399920405
                ],
                [
                  46.703880294549599,
                  24.78281437895312
                ],
                [
                  46.703754362287462,
                  24.782761871153884
                ],
                [
                  46.704058369207694,
                  24.782154174958091
                ],
                [
                  46.704184300963497,
                  24.782206683434293
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 2,
            "رقم_العقار": "8",
            "رقم_القطعة": "حديقة",
            "الاسم": "أمانة منطقة الرياض",
            "رقم_الصك": "",
            "تاريخ_الصك": "",
            "رقم_السجل": null,
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": null,
            "الاستخدام": "حديقه",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 3700,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "ارض فضاء",
            "مساحة_مسطحات_البناء": 0,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 247.99995741567227,
            "Shape_Area": 3699.9969533901422
          }
        },
        {
          "type": "Feature",
          "id": 3,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.70273683413086,
                  24.782883480963459
                ],
                [
                  46.702572502369016,
                  24.783211963622762
                ],
                [
                  46.702104754845386,
                  24.783016928431639
                ],
                [
                  46.702269087636154,
                  24.782688445322936
                ],
                [
                  46.70273683413086,
                  24.782883480963459
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 3,
            "رقم_العقار": "11",
            "رقم_القطعة": "حديقة",
            "الاسم": "أمانة منطقة الرياض",
            "رقم_الصك": "",
            "تاريخ_الصك": "",
            "رقم_السجل": null,
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": null,
            "الاستخدام": "حديقه",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 2080,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "ارض فضاء",
            "مساحة_مسطحات_البناء": 0,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 183.9999609046111,
            "Shape_Area": 2079.9988947806514
          }
        },
        {
          "type": "Feature",
          "id": 4,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.705095437698638,
                  24.782080407400372
                ],
                [
                  46.705347301906514,
                  24.782185421554228
                ],
                [
                  46.705244598830518,
                  24.782390725242319
                ],
                [
                  46.705141895433592,
                  24.782596028872675
                ],
                [
                  46.705039191715692,
                  24.78280133244532
                ],
                [
                  46.704787327432911,
                  24.782696316919886
                ],
                [
                  46.704544457043106,
                  24.782595052897445
                ],
                [
                  46.704647161449401,
                  24.782389749624436
                ],
                [
                  46.704749865534744,
                  24.782184446293673
                ],
                [
                  46.704852569299113,
                  24.781979142905186
                ],
                [
                  46.705095437698638,
                  24.782080407400372
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 4,
            "رقم_العقار": "2",
            "رقم_القطعة": "7-8-9-10-11-12",
            "الاسم": "شركة ابعاد للاستثمار العقاري",
            "رقم_الصك": "795120000140",
            "تاريخ_الصك": "1443/2/5",
            "رقم_السجل": "7001511992",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "4125",
            "الاستخدام": "تجاري",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 4125,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 8758.37988,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 260.00019142253905,
            "Shape_Area": 4125.0015903068888
          }
        },
        {
          "type": "Feature",
          "id": 5,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.704787327432911,
                  24.782696316919886
                ],
                [
                  46.705039191715692,
                  24.78280133244532
                ],
                [
                  46.704936488653303,
                  24.783006635046242
                ],
                [
                  46.70468462304359,
                  24.782901620282257
                ],
                [
                  46.704441753304664,
                  24.782800356101486
                ],
                [
                  46.704544457043106,
                  24.782595052897445
                ],
                [
                  46.704787327432911,
                  24.782696316919886
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 5,
            "رقم_العقار": "3",
            "رقم_القطعة": "5-6",
            "الاسم": "طارق بن عبدالله بن عبدالعزيز الشدي",
            "رقم_الصك": "310118030895",
            "تاريخ_الصك": "1435/9/12",
            "رقم_السجل": "1029902945",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "1375",
            "الاستخدام": "تجاري",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 1375,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني تحت الانشاء",
            "مساحة_مسطحات_البناء": 2439.42993,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 159.99984446787496,
            "Shape_Area": 1374.9987771815347
          }
        },
        {
          "type": "Feature",
          "id": 6,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.70468462304359,
                  24.782901620282257
                ],
                [
                  46.704936488653303,
                  24.783006635046242
                ],
                [
                  46.704833784293491,
                  24.78321193850342
                ],
                [
                  46.704581918333304,
                  24.783106923586914
                ],
                [
                  46.704339048244087,
                  24.783005658356316
                ],
                [
                  46.704441753304664,
                  24.782800356101486
                ],
                [
                  46.70468462304359,
                  24.782901620282257
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 6,
            "رقم_العقار": "4",
            "رقم_القطعة": "3-4",
            "الاسم": "شركة ابناء عبدالله التركي الضحيان للمقاولات",
            "رقم_الصك": "410118021324",
            "تاريخ_الصك": "1433/8/19",
            "رقم_السجل": "7001698245",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "1375",
            "الاستخدام": "تجاري",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 1375,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 1626.06995,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 159.99992981419072,
            "Shape_Area": 1374.999995951141
          }
        },
        {
          "type": "Feature",
          "id": 7,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.704581918333304,
                  24.783106923586914
                ],
                [
                  46.704833784293491,
                  24.78321193850342
                ],
                [
                  46.704689998439079,
                  24.783499363056947
                ],
                [
                  46.70443813198824,
                  24.783394347926869
                ],
                [
                  46.704195260437082,
                  24.783293082501597
                ],
                [
                  46.704339048244087,
                  24.783005658356316
                ],
                [
                  46.704581918333304,
                  24.783106923586914
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 7,
            "رقم_العقار": "5",
            "رقم_القطعة": "1",
            "الاسم": "ضحيان بن عبدالله بن تركي الضحيان",
            "رقم_الصك": "210203002984",
            "تاريخ_الصك": "1433/9/12",
            "رقم_السجل": "1034568517",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "1925",
            "الاستخدام": "تجاري",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 1925,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "ارض فضاء",
            "مساحة_مسطحات_البناء": 0,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 180.00011728372667,
            "Shape_Area": 1925.0017366634197
          }
        },
        {
          "type": "Feature",
          "id": 8,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.704874178782561,
                  24.781392652201429
                ],
                [
                  46.705099056247924,
                  24.781486415629608
                ],
                [
                  46.705323934034219,
                  24.781580178700501
                ],
                [
                  46.705593787203185,
                  24.78169269355962
                ],
                [
                  46.705499301126373,
                  24.781881572576246
                ],
                [
                  46.705408923410161,
                  24.782062240038105
                ],
                [
                  46.7051390685765,
                  24.781949724896105
                ],
                [
                  46.704914191215792,
                  24.781855961568841
                ],
                [
                  46.704689313187231,
                  24.781762197895539
                ],
                [
                  46.7043295088138,
                  24.781612175457902
                ],
                [
                  46.704419888852833,
                  24.781431509462749
                ],
                [
                  46.704514376299052,
                  24.78124263014476
                ],
                [
                  46.704874178782561,
                  24.781392652201429
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 8,
            "رقم_العقار": "1",
            "رقم_القطعة": "21-22-23-24-25-26-27-28",
            "الاسم": "محمد بن عبدالعزيز بن سليمان العجاجي",
            "رقم_الصك": "16/13835",
            "تاريخ_الصك": "1409/1/30",
            "رقم_السجل": "1016935825",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "5400",
            "الاستخدام": "تجاري (نادي رياضي)",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 5400,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 4276.95996,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 330.00012914881023,
            "Shape_Area": 5400.0016757658441
          }
        },
        {
          "type": "Feature",
          "id": 9,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.70434487014635,
                  24.78212475752489
                ],
                [
                  46.704569748620649,
                  24.782218521690389
                ],
                [
                  46.704508126210811,
                  24.782341703809799
                ],
                [
                  46.704283247548773,
                  24.782247939562584
                ],
                [
                  46.704184300963497,
                  24.782206683434293
                ],
                [
                  46.704058369207694,
                  24.782154174958091
                ],
                [
                  46.704119992005332,
                  24.782030993904847
                ],
                [
                  46.70434487014635,
                  24.78212475752489
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 9,
            "رقم_العقار": "7",
            "رقم_القطعة": "سكن الامام",
            "الاسم": "وزارة الشئون الإسلامية والأوقاف",
            "رقم_الصك": "",
            "تاريخ_الصك": "",
            "رقم_السجل": null,
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": null,
            "الاستخدام": "سكني",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 750,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني تحت الانشاء",
            "مساحة_مسطحات_البناء": 663.200012,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 130.00005303788197,
            "Shape_Area": 750.00131375373223
          }
        },
        {
          "type": "Feature",
          "id": 10,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.703399658045491,
                  24.782514723144345
                ],
                [
                  46.703615541190132,
                  24.78260473764362
                ],
                [
                  46.703512834885466,
                  24.782810040303463
                ],
                [
                  46.703430670198962,
                  24.782974282021911
                ],
                [
                  46.703214786513655,
                  24.782884267287251
                ],
                [
                  46.702998903124168,
                  24.782794252223344
                ],
                [
                  46.703081068278934,
                  24.782630009811378
                ],
                [
                  46.703183775196678,
                  24.782424708315787
                ],
                [
                  46.703399658045491,
                  24.782514723144345
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 10,
            "رقم_العقار": "10",
            "رقم_القطعة": "67-68-69-70",
            "الاسم": "شركة روف الرابعة للتطوير العقاري شخص واحد",
            "رقم_الصك": "318501003907",
            "تاريخ_الصك": "1445/3/3",
            "رقم_السجل": "7034554977",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "2160",
            "الاستخدام": "سكني",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 2160,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني تحت الانشاء",
            "مساحة_مسطحات_البناء": 5621.7002,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 185.99992538924153,
            "Shape_Area": 2159.9992695263031
          }
        },
        {
          "type": "Feature",
          "id": 11,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.703983134363838,
                  24.782956509758137
                ],
                [
                  46.704163038746117,
                  24.783031520945023
                ],
                [
                  46.704060333060767,
                  24.783236823940022
                ],
                [
                  46.703880429416984,
                  24.783161812632912
                ],
                [
                  46.7036105733415,
                  24.783049294803416
                ],
                [
                  46.703713279652654,
                  24.782843992080803
                ],
                [
                  46.703983134363838,
                  24.782956509758137
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 11,
            "رقم_العقار": "9",
            "رقم_القطعة": "37\\ج",
            "الاسم": "منيره عبدالله حسن الاحيدب ",
            "رقم_الصك": "460604005918",
            "تاريخ_الصك": "1445/11/11",
            "رقم_السجل": "1029830880",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "500",
            "الاستخدام": "سكني",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 500,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 1081.08997,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 150.00010739212257,
            "Shape_Area": 1250.0010785939464
          }
        },
        {
          "type": "Feature",
          "id": 12,
          "geometry": {
            "type": "Polygon",
            "coordinates": [
              [
                [
                  46.702277002868037,
                  24.783237626651598
                ],
                [
                  46.702510876516605,
                  24.78333514504731
                ],
                [
                  46.702379409670698,
                  24.783597930669576
                ],
                [
                  46.702330110095147,
                  24.783696475923541
                ],
                [
                  46.702096234897382,
                  24.783598958192467
                ],
                [
                  46.701862361023338,
                  24.783501439160986
                ],
                [
                  46.701911661912412,
                  24.783402894934518
                ],
                [
                  46.702043129578996,
                  24.783140108772198
                ],
                [
                  46.702277002868037,
                  24.783237626651598
                ]
              ]
            ]
          },
          "properties": {
            "OBJECTID": 12,
            "رقم_العقار": "12",
            "رقم_القطعة": "825-827-826-828",
            "الاسم": "حمد محمد بن عبدالله بن سعيدان",
            "رقم_الصك": "310701000543",
            "تاريخ_الصك": "1438/5/18",
            "رقم_السجل": "1000259125",
            "المخطط": "1822/س",
            "الحي": "التعاون",
            "مساحة_الصك": "2288",
            "الاستخدام": "تجاري (مطعم)",
            "المدينة": null,
            "المنطقة": "الرياض",
            "مساحة_الطبيعة": 2288,
            "فرق_المساحة": 0,
            "نوع_النزع": "بالكامل",
            "حالة_العقار": "مبني قائم",
            "مساحة_مسطحات_البناء": 540,
            "توقيع_المالك": "تم التوقيع",
            "Shape_Length": 191.99990418935275,
            "Shape_Area": 2287.9981610779651
          }
        }
      ]
    };
    
    // Add to map using existing function
    await addGeoJSONToMap(geoJSONData, 'مشروع المياه نزع التعاون');

    console.log("🟢 Static layer added to map. Total layers:", displayMap.allLayers.length);
    console.log("🟢 All layers:", displayMap.allLayers.items);


    // Wait a bit for layer to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Find the static layer
    const staticLayer = displayMap.allLayers.find(layer => 
      layer.title === 'مشروع المياه نزع التعاون'
    );

    console.log("🟢 Found static layer:", staticLayer);

    if (staticLayer) {
      console.log("🟢 Layer fields:", staticLayer.fields);
      console.log("🟢 Layer features count:", staticLayer.source?.length);
      
      // Check if we have the الاستخدام field
      const usageField = staticLayer.fields.find(field => field.name === 'الاستخدام');
      console.log("🟢 Usage field found:", usageField);
      
      // Log all field names to verify
      console.log("🟢 All field names:", staticLayer.fields.map(f => f.name));
    }

    // Apply auto-classification
    await autoClassifyStaticLayer();


  } catch (error) {
    console.error('Error loading static GeoJSON layer:', error);
  }
}


// Auto-classify the static layer
async function autoClassifyStaticLayer() {
  console.log("🔵 Starting auto-classification...");
  
  // Find the static layer
  const staticLayer = displayMap.allLayers.find(layer => 
    layer.title === 'مشروع المياه نزع التعاون'
  );
  
  if (!staticLayer) {
    console.error("❌ Static layer not found for classification");
    return;
  }
  
  // Set as current classification layer
  currentClassificationLayer = staticLayer;
  
  console.log("🔵 Applying classification for field: الاستخدام");

  try {
  // Get field statistics
  const stats = await analyzeFieldValues(staticLayer, 'الاستخدام');
  
  if (!stats || stats.uniqueCount === 0) {
    console.error("❌ No valid values found for classification");
    return;
  }
  
  console.log("🔵 Field statistics:", stats);
  
  // Generate colors
  const colors = generateColors(stats.sortedValues.length);
  
  // Create unique value infos
  const uniqueValueInfos = stats.sortedValues.map(([value, count], index) => {
    const color = colors[index];
    
    return {
      value: value,
      symbol: {
        type: "simple-fill",
        color: [...color, 0.7],
        outline: {
          color: color,
          width: 2
        }
      },
      label: `${value} (${count})`
    };
  });
  
  // Create and apply the renderer
  const renderer = {
    type: "unique-value",
    field: "الاستخدام",
    uniqueValueInfos: uniqueValueInfos,
    defaultSymbol: createDefaultSymbol("polygon"),
    defaultLabel: "أخرى"
  };
  
  staticLayer.renderer = renderer;
  console.log("🔵 Renderer applied successfully");
  
  // Create and show legend
  createMapLegend(stats, colors, "الاستخدام");
  console.log("🔵 Legend created and displayed");
// Show classification loading
const classificationLoading = document.getElementById('classificationLoading');
classificationLoading.classList.remove('hidden');

  // Add small delay to ensure loading is visible
  await new Promise(resolve => setTimeout(resolve, 1000));
  // Hide loading
  classificationLoading.classList.add('hidden');

} catch (error) {
  console.error("❌ Error in auto-classification:", error);
  // Hide loading on error
  classificationLoading.classList.add('hidden');
}

  
  // We'll add the classification logic next
}


// ========================================
// MAIN: APPLICATION INITIALIZATION
// ========================================
async function initApp() {
  try {
    await initializeMap();

    // Load static GeoJSON layer
    await loadStaticGeoJSONLayer();

    initializeUpload();
    initializeFeaturePanel();
    initializeCustomWidgets();
    initializeClassificationPanel();
    initializeCoordinatesWidget();

    console.log("نظام متابعة المخططات initialized successfully!", displayMap, view);
  } catch (error) {
    console.error("Error initializing application:", error);
  }
}

// Start the application
initApp();