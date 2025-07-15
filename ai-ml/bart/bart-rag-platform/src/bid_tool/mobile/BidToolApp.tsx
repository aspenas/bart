"""
Mobile app interface for BART bid tool.
React Native implementation for iOS/Android.
"""

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { Camera } from 'react-native-camera';
import Voice from 'react-native-voice';
import Geolocation from 'react-native-geolocation-service';

// Project creation screen
export const NewProjectScreen = ({ navigation }) => {
  const [clientName, setClientName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [projectType, setProjectType] = useState('exterior');

  const createProject = async () => {
    try {
      const response = await fetch('/api/v1/bid-tool/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: clientName,
          client_phone: phone,
          client_address: address,
          lead_paint_year: parseInt(yearBuilt),
          project_type: projectType,
        }),
      });
      
      const project = await response.json();
      navigation.navigate('Measurement', { projectId: project.id });
    } catch (error) {
      Alert.alert('Error', 'Failed to create project');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>New Project</Text>
        
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Client Name *</Text>
          <TextInput
            style={styles.input}
            value={clientName}
            onChangeText={setClientName}
            placeholder="John Smith"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main St"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Year Built</Text>
          <TextInput
            style={styles.input}
            value={yearBuilt}
            onChangeText={setYearBuilt}
            placeholder="1985"
            keyboardType="numeric"
          />
          {yearBuilt && parseInt(yearBuilt) < 1978 && (
            <Text style={styles.warning}>
              ⚠️ Lead paint risk - EPA RRP rules apply
            </Text>
          )}
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Project Type</Text>
          <View style={styles.buttonGroup}>
            {['exterior', 'interior', 'cabinet'].map(type => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.typeButton,
                  projectType === type && styles.selectedButton,
                ]}
                onPress={() => setProjectType(type)}
              >
                <Text style={styles.buttonText}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={createProject}
          disabled={!clientName}
        >
          <Text style={styles.primaryButtonText}>Start Measurements</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

// Measurement screen with photo capture
export const MeasurementScreen = ({ route, navigation }) => {
  const { projectId } = route.params;
  const [currentArea, setCurrentArea] = useState('Front Elevation');
  const [measurements, setMeasurements] = useState({
    siding_type: 'vinyl',
    body_sqft: '',
    trim_linear_ft: '',
    notes: '',
  });
  const [photos, setPhotos] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [location, setLocation] = useState(null);

  useEffect(() => {
    // Get location for measurement
    Geolocation.getCurrentPosition(
      position => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      error => console.log(error),
      { enableHighAccuracy: true }
    );
  }, []);

  const takePicture = async (camera) => {
    const options = { quality: 0.8, base64: true };
    const data = await camera.takePictureAsync(options);
    setPhotos([...photos, data.uri]);
  };

  const startVoiceNote = async () => {
    try {
      await Voice.start('en-US');
      setIsRecording(true);
    } catch (error) {
      Alert.alert('Error', 'Voice recording not available');
    }
  };

  const saveMeasurement = async () => {
    try {
      const response = await fetch(
        `/api/v1/bid-tool/projects/${projectId}/measurements`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'exterior',
            area_name: currentArea,
            data: measurements,
            photos: photos,
            latitude: location?.latitude,
            longitude: location?.longitude,
          }),
        }
      );

      if (response.ok) {
        Alert.alert('Success', 'Measurement saved', [
          {
            text: 'Add Another Area',
            onPress: () => {
              setCurrentArea('');
              setMeasurements({});
              setPhotos([]);
            },
          },
          {
            text: 'Calculate Bid',
            onPress: () => navigation.navigate('Calculate', { projectId }),
          },
        ]);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to save measurement');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>Exterior Measurements</Text>
        <Text style={styles.subtitle}>{currentArea}</Text>

        <View style={styles.photoSection}>
          <Text style={styles.label}>Photos</Text>
          <View style={styles.photoGrid}>
            {photos.map((photo, index) => (
              <Image key={index} source={{ uri: photo }} style={styles.photo} />
            ))}
            <TouchableOpacity style={styles.addPhotoButton}>
              <Text style={styles.addPhotoText}>+ Add Photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Siding Type</Text>
          <View style={styles.buttonGroup}>
            {['vinyl', 'wood', 'stucco', 'brick'].map(type => (
              <TouchableOpacity
                key={type}
                style={[
                  styles.typeButton,
                  measurements.siding_type === type && styles.selectedButton,
                ]}
                onPress={() =>
                  setMeasurements({ ...measurements, siding_type: type })
                }
              >
                <Text style={styles.buttonText}>
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Body Square Feet</Text>
          <TextInput
            style={styles.input}
            value={measurements.body_sqft}
            onChangeText={text =>
              setMeasurements({ ...measurements, body_sqft: text })
            }
            placeholder="0"
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Trim Linear Feet</Text>
          <TextInput
            style={styles.input}
            value={measurements.trim_linear_ft}
            onChangeText={text =>
              setMeasurements({ ...measurements, trim_linear_ft: text })
            }
            placeholder="0"
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={measurements.notes}
            onChangeText={text =>
              setMeasurements({ ...measurements, notes: text })
            }
            placeholder="Special conditions, repairs needed, etc."
            multiline
            numberOfLines={3}
          />
          <TouchableOpacity
            style={styles.voiceButton}
            onPress={startVoiceNote}
          >
            <Text style={styles.voiceButtonText}>
              {isRecording ? '🔴 Recording...' : '🎤 Voice Note'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={saveMeasurement}
        >
          <Text style={styles.primaryButtonText}>Save Measurement</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

// Calculation screen
export const CalculationScreen = ({ route }) => {
  const { projectId } = route.params;
  const [calculation, setCalculation] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    calculateBid();
  }, []);

  const calculateBid = async () => {
    try {
      const response = await fetch(
        `/api/v1/bid-tool/projects/${projectId}/calculate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
      
      const result = await response.json();
      setCalculation(result);
      setLoading(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to calculate bid');
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>Calculating...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.title}>Bid Summary</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.totalLabel}>Total Estimate</Text>
          <Text style={styles.totalAmount}>
            ${calculation?.calculations?.total?.toFixed(2) || '0.00'}
          </Text>
        </View>

        <View style={styles.breakdownSection}>
          <Text style={styles.sectionTitle}>Cost Breakdown</Text>
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Materials</Text>
            <Text style={styles.breakdownValue}>
              ${calculation?.calculations?.material_cost?.toFixed(2) || '0.00'}
            </Text>
          </View>
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Labor</Text>
            <Text style={styles.breakdownValue}>
              ${calculation?.calculations?.labor_cost?.toFixed(2) || '0.00'}
            </Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Subtotal</Text>
            <Text style={styles.breakdownValue}>
              ${calculation?.calculations?.subtotal?.toFixed(2) || '0.00'}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Generate PDF Quote</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Email to Customer</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  input: {
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  buttonGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  selectedButton: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  buttonText: {
    fontSize: 14,
    color: '#333',
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  secondaryButtonText: {
    color: '#007AFF',
    fontSize: 18,
    fontWeight: '600',
  },
  warning: {
    color: '#FF9500',
    fontSize: 14,
    marginTop: 5,
  },
  photoSection: {
    marginBottom: 20,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  addPhotoButton: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#007AFF',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPhotoText: {
    color: '#007AFF',
    fontSize: 14,
  },
  voiceButton: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#FF3B30',
    borderRadius: 8,
    alignItems: 'center',
  },
  voiceButtonText: {
    color: 'white',
    fontSize: 16,
  },
  summaryCard: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  totalLabel: {
    fontSize: 16,
    color: '#666',
    marginBottom: 5,
  },
  totalAmount: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  breakdownSection: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  breakdownLabel: {
    fontSize: 16,
    color: '#666',
  },
  breakdownValue: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 10,
  },
});